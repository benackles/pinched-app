import "server-only";

import type Stripe from "stripe";

import type { Row } from "@/db/types";
import { mustMaybe, mustOk } from "@/server/db";
import type { Supabase } from "@/server/supabase";

export type SubscriptionRow = Omit<Row<"subscriptions">, "created_at" | "updated_at">;

const iso = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;

/** Which of Pinched's plans a Stripe subscription is on, from its price. */
export function planOf(
  subscription: Stripe.Subscription,
  prices: { monthly?: string | undefined; yearly?: string | undefined },
): "monthly" | "yearly" | null {
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  if (priceId && priceId === prices.monthly) return "monthly";
  if (priceId && priceId === prices.yearly) return "yearly";
  const interval = item?.price.recurring?.interval;
  return interval === "month" ? "monthly" : interval === "year" ? "yearly" : null;
}

/** A Stripe subscription as the `subscriptions` row the app reads. Pure. */
export function mapSubscription(
  subscription: Stripe.Subscription,
  userId: string,
  prices: { monthly?: string | undefined; yearly?: string | undefined },
): SubscriptionRow {
  const item = subscription.items.data[0];
  const customer =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  return {
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customer,
    status: subscription.status,
    plan: planOf(subscription, prices),
    price_id: item?.price.id ?? null,
    current_period_end: iso(item?.current_period_end),
    trial_end: iso(subscription.trial_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}

const LIVE = new Set(["trialing", "active", "past_due"]);
const DEAD = new Set(["canceled", "incomplete_expired", "unpaid"]);

/**
 * Who a subscription belongs to. The user id we put on the subscription at checkout is trusted
 * (it arrived inside a signature-verified event); failing that, the customer id we stored on the
 * profile when checkout completed.
 */
export async function resolveUserId(
  admin: Supabase,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.user_id;
  if (fromMetadata) return fromMetadata;
  const customer =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const profile = mustMaybe(
    await admin.from("profiles").select("user_id").eq("stripe_customer_id", customer).maybeSingle(),
  );
  return profile?.user_id ?? null;
}

export type SubscriptionChange = "started" | "converted" | "ended" | "updated";

/**
 * Writes the row. One row per person; a later subscription replaces an earlier one. A delayed
 * "canceled" event for an OLD subscription must not wipe out the new active one, so it is ignored.
 *
 * `change` says what this write meant, for analytics: "started" only the first time a subscription
 * becomes live (webhook retries and the several events Stripe sends for one signup all resolve to
 * "updated" after that), "converted" when a free trial turns into a paid plan, "ended" when a live
 * subscription ends.
 */
export async function upsertSubscription(
  admin: Supabase,
  row: SubscriptionRow,
): Promise<{ outcome: "written" | "ignored"; change: SubscriptionChange | null }> {
  const current = mustMaybe(
    await admin.from("subscriptions").select("*").eq("user_id", row.user_id).maybeSingle(),
  );
  if (
    current &&
    current.stripe_subscription_id !== row.stripe_subscription_id &&
    LIVE.has(current.status) &&
    DEAD.has(row.status)
  ) {
    return { outcome: "ignored", change: null };
  }
  mustOk(
    await admin
      .from("subscriptions")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" }),
  );

  const sameSubscription = current?.stripe_subscription_id === row.stripe_subscription_id;
  const wasLive = Boolean(current && sameSubscription && LIVE.has(current.status));
  let change: SubscriptionChange = "updated";
  if (!wasLive && (row.status === "trialing" || row.status === "active")) change = "started";
  else if (wasLive && current?.status === "trialing" && row.status === "active")
    change = "converted";
  else if (wasLive && DEAD.has(row.status)) change = "ended";
  return { outcome: "written", change };
}

/** Links the Stripe customer to the person (the billing portal is opened for this id). */
export async function linkCustomer(admin: Supabase, userId: string, customerId: string) {
  const { error } = await admin
    .from("profiles")
    .update({ stripe_customer_id: customerId })
    .eq("user_id", userId);
  // A customer id belongs to one profile; a duplicate means it is already linked elsewhere.
  if (error && error.code !== "23505") mustOk({ error });
}

export async function currentSubscription(db: Supabase): Promise<Row<"subscriptions"> | null> {
  return mustMaybe(await db.from("subscriptions").select("*").maybeSingle());
}
