import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/types";
import { mapSubscription } from "@/server/billing/subscription";
import { handleStripeEvent, type StripeApi } from "@/server/billing/webhook";
import { signJwt, verifyJwt } from "@/server/local/jwt";
import { handlePostgrest, type Queryable } from "@/server/local/postgrest/handler";

import { asUser, createTestDb, type Db } from "../support/db";

const SECRET = "billing-test";
const PRICES = { monthly: "price_monthly", yearly: "price_yearly" };
const ALICE = "user_alice";
const BOB = "user_bob";

let db: Db;
const serviceToken = signJwt({ role: "service_role" }, SECRET, 600);
const anonKey = signJwt({ role: "anon" }, SECRET, 600);

const admin = () =>
  createClient<Database>("http://shim.test", anonKey, {
    accessToken: async () => serviceToken,
    global: {
      fetch: (input, init) =>
        handlePostgrest(new Request(input, init), {
          db: db as unknown as Queryable,
          verifyToken: (token) => verifyJwt(token, SECRET),
        }),
    },
  });

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(
    `insert into profiles (user_id, email) values ('${ALICE}', 'a@example.test'), ('${BOB}', 'b@example.test')`,
  );
});
afterAll(async () => {
  await db.close();
});

function subscription(
  over: Partial<{
    id: string;
    status: string;
    customer: string;
    price: string;
    interval: "month" | "year";
    periodEnd: number;
    trialEnd: number | null;
    cancelAtPeriodEnd: boolean;
    userId: string | null;
  }> = {},
): Stripe.Subscription {
  const o = {
    id: "sub_1",
    status: "active",
    customer: "cus_alice",
    price: PRICES.monthly,
    interval: "month" as const,
    periodEnd: Math.floor(Date.now() / 1000) + 20 * 86400,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    userId: ALICE as string | null,
    ...over,
  };
  return {
    id: o.id,
    object: "subscription",
    status: o.status,
    customer: o.customer,
    cancel_at_period_end: o.cancelAtPeriodEnd,
    trial_end: o.trialEnd,
    metadata: o.userId ? { user_id: o.userId } : {},
    items: {
      object: "list",
      data: [
        {
          price: { id: o.price, recurring: { interval: o.interval } },
          current_period_end: o.periodEnd,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

const event = (type: string, object: unknown) =>
  ({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object },
  }) as unknown as Stripe.Event;

function fakeStripe(subs: Record<string, Stripe.Subscription>): StripeApi {
  return {
    subscriptions: {
      retrieve: async (id) => {
        const found = subs[id];
        if (!found) throw new Error(`no such subscription ${id}`);
        return found;
      },
    },
  };
}

const isPro = (user: string) =>
  asUser(
    db,
    user,
    async (tx) => (await tx.query<{ r: boolean }>("select is_pro() as r")).rows[0]!.r,
  );
const rowFor = async (user: string) =>
  (
    await db.query<Record<string, unknown>>("select * from subscriptions where user_id = $1", [
      user,
    ])
  ).rows[0];

describe("mapSubscription", () => {
  it("maps plan, period and trial from the subscription item", () => {
    const trial = Math.floor(Date.now() / 1000) + 14 * 86400;
    const row = mapSubscription(
      subscription({ status: "trialing", trialEnd: trial, interval: "year", price: PRICES.yearly }),
      ALICE,
      PRICES,
    );
    expect(row).toMatchObject({
      user_id: ALICE,
      stripe_subscription_id: "sub_1",
      stripe_customer_id: "cus_alice",
      status: "trialing",
      plan: "yearly",
      price_id: PRICES.yearly,
      cancel_at_period_end: false,
    });
    expect(row.trial_end).toBe(new Date(trial * 1000).toISOString());
    expect(row.current_period_end).toBeTruthy();
  });

  it("falls back to the price interval when the price id is unknown", () => {
    const row = mapSubscription(
      subscription({ price: "price_other", interval: "month" }),
      ALICE,
      PRICES,
    );
    expect(row.plan).toBe("monthly");
  });
});

describe("Stripe webhook events", () => {
  it("checkout.session.completed links the customer and unlocks Pro", async () => {
    const sub = subscription({
      status: "trialing",
      trialEnd: Math.floor(Date.now() / 1000) + 14 * 86400,
    });
    const result = await handleStripeEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: ALICE,
        customer: "cus_alice",
        subscription: "sub_1",
      }),
      { admin: admin(), stripe: fakeStripe({ sub_1: sub }), prices: PRICES },
    );
    expect(result.handled).toBe(true);
    expect(
      (
        await db.query<{ c: string }>(
          "select stripe_customer_id as c from profiles where user_id = $1",
          [ALICE],
        )
      ).rows[0]?.c,
    ).toBe("cus_alice");
    expect(await rowFor(ALICE)).toMatchObject({ status: "trialing", plan: "monthly" });
    expect(await isPro(ALICE)).toBe(true);
    expect(await isPro(BOB)).toBe(false);
  });

  it("uses the user id from the verified event, never anything a client could send", async () => {
    // A subscription whose metadata names someone else is still written under the session's user.
    const sub = subscription({ id: "sub_b", customer: "cus_bob", userId: ALICE });
    await handleStripeEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: BOB,
        customer: "cus_bob",
        subscription: "sub_b",
      }),
      { admin: admin(), stripe: fakeStripe({ sub_b: sub }), prices: PRICES },
    );
    expect(await rowFor(BOB)).toMatchObject({ stripe_subscription_id: "sub_b", user_id: BOB });
  });

  it("customer.subscription.updated re-reads the latest state (past_due keeps access, canceled ends it)", async () => {
    const stale = subscription({ status: "active" });
    const latest = subscription({ status: "past_due" });
    await handleStripeEvent(event("customer.subscription.updated", stale), {
      admin: admin(),
      stripe: fakeStripe({ sub_1: latest }),
      prices: PRICES,
    });
    expect(await rowFor(ALICE)).toMatchObject({ status: "past_due" });
    expect(await isPro(ALICE)).toBe(true);

    await handleStripeEvent(
      event(
        "customer.subscription.deleted",
        subscription({
          status: "canceled",
          cancelAtPeriodEnd: false,
          periodEnd: Math.floor(Date.now() / 1000) - 10 * 86400,
        }),
      ),
      {
        admin: admin(),
        stripe: fakeStripe({}),
        prices: PRICES,
      },
    );
    expect(await rowFor(ALICE)).toMatchObject({ status: "canceled" });
    expect(await isPro(ALICE)).toBe(false);
  });

  it("ignores a late 'canceled' for an old subscription when a newer one is active", async () => {
    await handleStripeEvent(
      event("customer.subscription.created", subscription({ id: "sub_new" })),
      {
        admin: admin(),
        stripe: fakeStripe({ sub_new: subscription({ id: "sub_new", status: "active" }) }),
        prices: PRICES,
      },
    );
    expect(await rowFor(ALICE)).toMatchObject({
      stripe_subscription_id: "sub_new",
      status: "active",
    });

    const late = await handleStripeEvent(
      event("customer.subscription.deleted", subscription({ id: "sub_1", status: "canceled" })),
      {
        admin: admin(),
        stripe: fakeStripe({}),
        prices: PRICES,
      },
    );
    expect(late.handled).toBe(false);
    expect(await rowFor(ALICE)).toMatchObject({
      stripe_subscription_id: "sub_new",
      status: "active",
    });
    expect(await isPro(ALICE)).toBe(true);
  });

  it("invoice.payment_failed marks the subscription past_due", async () => {
    const pastDue = subscription({ id: "sub_new", status: "past_due" });
    await handleStripeEvent(
      event("invoice.payment_failed", {
        parent: { subscription_details: { subscription: "sub_new" } },
      }),
      {
        admin: admin(),
        stripe: fakeStripe({ sub_new: pastDue }),
        prices: PRICES,
      },
    );
    expect(await rowFor(ALICE)).toMatchObject({ status: "past_due" });
  });

  it("resolves the person from the stored customer id when the subscription has no metadata", async () => {
    const orphan = subscription({
      id: "sub_orphan",
      customer: "cus_bob",
      userId: null,
      status: "active",
    });
    await db.exec("delete from subscriptions where user_id = 'user_bob'");
    const result = await handleStripeEvent(event("customer.subscription.updated", orphan), {
      admin: admin(),
      stripe: fakeStripe({ sub_orphan: orphan }),
      prices: PRICES,
    });
    expect(result.handled).toBe(true);
    expect(await rowFor(BOB)).toMatchObject({ stripe_subscription_id: "sub_orphan" });
  });

  it("writes nothing for a customer it cannot place, for other checkout modes, or for unrelated events", async () => {
    const before = (await db.query("select count(*)::int as n from subscriptions")).rows[0] as {
      n: number;
    };
    const none = subscription({ id: "sub_x", customer: "cus_nobody", userId: null });
    expect(
      (
        await handleStripeEvent(event("customer.subscription.updated", none), {
          admin: admin(),
          stripe: fakeStripe({ sub_x: none }),
          prices: PRICES,
        })
      ).handled,
    ).toBe(false);
    expect(
      (
        await handleStripeEvent(
          event("checkout.session.completed", { mode: "payment", client_reference_id: ALICE }),
          { admin: admin(), stripe: fakeStripe({}), prices: PRICES },
        )
      ).handled,
    ).toBe(false);
    expect(
      (
        await handleStripeEvent(event("charge.refunded", {}), {
          admin: admin(),
          stripe: fakeStripe({}),
          prices: PRICES,
        })
      ).detail,
    ).toMatch(/ignored/);
    const after = (await db.query("select count(*)::int as n from subscriptions")).rows[0] as {
      n: number;
    };
    expect(after.n).toBe(before.n);
  });
});

describe("subscription changes (reported once, for analytics)", () => {
  const CAROL = "user_carol";
  const trialEnd = () => Math.floor(Date.now() / 1000) + 14 * 86400;
  const checkout = {
    mode: "subscription",
    client_reference_id: CAROL,
    customer: "cus_carol",
    subscription: "sub_c",
  };

  it("a start is reported once, however many events Stripe sends for one signup", async () => {
    await db.exec(`insert into profiles (user_id, email) values ('${CAROL}', 'c@example.test')`);
    const trialing = subscription({
      id: "sub_c",
      customer: "cus_carol",
      userId: CAROL,
      status: "trialing",
      trialEnd: trialEnd(),
    });
    const deps = { admin: admin(), stripe: fakeStripe({ sub_c: trialing }), prices: PRICES };

    const first = await handleStripeEvent(event("checkout.session.completed", checkout), deps);
    expect(first.change).toEqual({ userId: CAROL, kind: "started", plan: "monthly", trial: true });

    // The same signup also produces subscription.created and subscription.updated — and retries.
    for (const again of [
      event("customer.subscription.created", trialing),
      event("customer.subscription.updated", trialing),
      event("checkout.session.completed", checkout),
    ]) {
      expect((await handleStripeEvent(again, deps)).change).toBeUndefined();
    }
  });

  it("the trial turning into a paid plan is a conversion, once", async () => {
    const active = subscription({
      id: "sub_c",
      customer: "cus_carol",
      userId: CAROL,
      status: "active",
    });
    const deps = { admin: admin(), stripe: fakeStripe({ sub_c: active }), prices: PRICES };
    const converted = await handleStripeEvent(event("customer.subscription.updated", active), deps);
    expect(converted.change).toEqual({
      userId: CAROL,
      kind: "converted",
      plan: "monthly",
      trial: false,
    });
    expect(
      (await handleStripeEvent(event("customer.subscription.updated", active), deps)).change,
    ).toBeUndefined();
  });

  it("an end is reported once; payment trouble and renewals report nothing", async () => {
    const deps = { admin: admin(), stripe: fakeStripe({}), prices: PRICES };
    const pastDue = subscription({
      id: "sub_c",
      customer: "cus_carol",
      userId: CAROL,
      status: "past_due",
    });
    expect(
      (
        await handleStripeEvent(event("customer.subscription.updated", pastDue), {
          ...deps,
          stripe: fakeStripe({ sub_c: pastDue }),
        })
      ).change,
    ).toBeUndefined();

    const canceled = subscription({
      id: "sub_c",
      customer: "cus_carol",
      userId: CAROL,
      status: "canceled",
    });
    const ended = await handleStripeEvent(event("customer.subscription.deleted", canceled), deps);
    expect(ended.change).toMatchObject({ userId: CAROL, kind: "ended" });
    expect(
      (await handleStripeEvent(event("customer.subscription.deleted", canceled), deps)).change,
    ).toBeUndefined();
  });

  it("a late event for an old subscription reports nothing", async () => {
    const deps = { admin: admin(), stripe: fakeStripe({}), prices: PRICES };
    const fresh = subscription({
      id: "sub_c2",
      customer: "cus_carol",
      userId: CAROL,
      status: "active",
    });
    const started = await handleStripeEvent(event("customer.subscription.created", fresh), {
      ...deps,
      stripe: fakeStripe({ sub_c2: fresh }),
    });
    expect(started.change?.kind).toBe("started"); // a re-subscription after the old one ended
    const late = await handleStripeEvent(
      event(
        "customer.subscription.deleted",
        subscription({ id: "sub_c", customer: "cus_carol", userId: CAROL, status: "canceled" }),
      ),
      deps,
    );
    expect(late.handled).toBe(false);
    expect(late.change).toBeUndefined();
  });
});
