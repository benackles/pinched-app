import "server-only";

import type Stripe from "stripe";

import type { Supabase } from "@/server/supabase";

import {
  linkCustomer,
  mapSubscription,
  resolveUserId,
  upsertSubscription,
  type SubscriptionRow,
} from "./subscription";

/** The slice of the Stripe client the handler needs (so tests can supply a fake). */
export type StripeApi = {
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
};

export type WebhookDeps = {
  admin: Supabase;
  stripe: StripeApi;
  prices: { monthly?: string | undefined; yearly?: string | undefined };
};

export type WebhookResult = {
  handled: boolean;
  detail: string;
  /** A subscription just started, converted from trial or ended (once, however many events Stripe sends). */
  change?: {
    userId: string;
    kind: "started" | "converted" | "ended";
    plan: string | null;
    trial: boolean;
  };
};

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

/** The subscription an invoice belongs to (the field moved between Stripe API versions). */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription;
  return (
    idOf(legacy) ??
    idOf(
      invoice.parent?.subscription_details?.subscription as
        string | { id: string } | null | undefined,
    )
  );
}

async function syncSubscription(
  deps: WebhookDeps,
  subscription: Stripe.Subscription,
  hintedUserId?: string | null,
): Promise<WebhookResult> {
  const userId = hintedUserId ?? (await resolveUserId(deps.admin, subscription));
  if (!userId) return { handled: false, detail: "no user for this subscription" };
  const row: SubscriptionRow = mapSubscription(subscription, userId, deps.prices);
  const { outcome, change } = await upsertSubscription(deps.admin, row);
  return {
    handled: outcome === "written",
    detail: `${subscription.status} (${outcome})`,
    ...(change === "started" || change === "converted" || change === "ended"
      ? {
          change: {
            userId,
            kind: change,
            plan: row.plan,
            trial: subscription.status === "trialing",
          },
        }
      : {}),
  };
}

/**
 * Applies a Stripe event to the database. Events are already signature-verified by the route.
 * Every write is an idempotent upsert, so Stripe's retries and out-of-order deliveries are safe:
 * for subscription events the latest state is re-read from Stripe rather than trusting the payload.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return { handled: false, detail: "not a subscription" };
      // The Clerk user id we sent when creating the session — inside a verified event.
      const userId = session.client_reference_id;
      const customerId = idOf(session.customer);
      if (!userId) return { handled: false, detail: "no client_reference_id" };
      if (customerId) await linkCustomer(deps.admin, userId, customerId);
      const subscriptionId = idOf(session.subscription);
      if (!subscriptionId) return { handled: true, detail: "customer linked" };
      const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
      return syncSubscription(deps, subscription, userId);
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const fresh = await deps.stripe.subscriptions.retrieve(event.data.object.id);
      return syncSubscription(deps, fresh);
    }

    case "customer.subscription.deleted":
      return syncSubscription(deps, event.data.object);

    case "invoice.payment_failed": {
      const subscriptionId = invoiceSubscriptionId(event.data.object);
      if (!subscriptionId) return { handled: false, detail: "invoice without a subscription" };
      return syncSubscription(deps, await deps.stripe.subscriptions.retrieve(subscriptionId));
    }

    default:
      return { handled: false, detail: `ignored ${event.type}` };
  }
}
