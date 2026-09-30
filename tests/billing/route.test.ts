import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";

const WEBHOOK_SECRET = "whsec_route_test";

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_route";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PINCHED_LOCAL = "1";
  process.env.PINCHED_LOCAL_DB = "memory";
  process.env.PINCHED_LOCAL_SECRET = "route-test-secret";
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.VERCEL;
});

const payload = JSON.stringify({
  id: "evt_route_1",
  object: "event",
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: "sub_route",
      object: "subscription",
      status: "canceled",
      customer: "cus_route",
      cancel_at_period_end: false,
      trial_end: null,
      metadata: { user_id: "user_route" },
      items: {
        object: "list",
        data: [
          {
            price: { id: "price_x", recurring: { interval: "month" } },
            current_period_end: 1790000000,
          },
        ],
      },
    },
  },
});

const signed = (body: string, secret = WEBHOOK_SECRET) =>
  new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: {
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }),
    },
  });

describe("POST /api/webhooks/stripe", () => {
  it("rejects a request with no signature", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a signature made with the wrong secret, and a tampered body", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    expect((await POST(signed(payload, "whsec_someone_else"))).status).toBe(400);
    const tampered = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: payload.replace("user_route", "user_attacker"),
      headers: {
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: WEBHOOK_SECRET,
        }),
      },
    });
    expect((await POST(tampered)).status).toBe(400);
  });

  it("accepts a correctly signed event and records the subscription", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(signed(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, handled: true });

    const { getLocalDb } = await import("@/server/local/db");
    const db = await getLocalDb();
    const { rows } = await db.query<{ status: string; user_id: string }>(
      "select user_id, status from subscriptions where stripe_subscription_id = 'sub_route'",
    );
    expect(rows[0]).toEqual({ user_id: "user_route", status: "canceled" });
  });

  it("is idempotent: Stripe retrying the same event changes nothing", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    expect((await POST(signed(payload))).status).toBe(200);
    const { getLocalDb } = await import("@/server/local/db");
    const db = await getLocalDb();
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from subscriptions where stripe_subscription_id = 'sub_route'",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("answers 503 until a webhook secret is configured", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      expect((await POST(signed(payload))).status).toBe(503);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});
