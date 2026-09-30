"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isLocalMode } from "@/lib/auth/config";
import { external } from "@/lib/routes";
import { requireSession } from "@/server/auth";
import {
  isBillingConfigured,
  priceFor,
  priceIds,
  PRO_PRICING,
  stripe,
} from "@/server/billing/stripe";
import { linkCustomer, mapSubscription, upsertSubscription } from "@/server/billing/subscription";
import { mustMaybe, mustOk } from "@/server/db";
import { appUrl } from "@/server/env";
import { adminClient, userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

const LIVE = new Set(["trialing", "active", "past_due"]);

const planSchema = z.object({ plan: z.enum(["monthly", "yearly"]) });

function requireBilling() {
  if (!isBillingConfigured()) {
    throw new ActionFailure("forbidden", "Billing isn't set up on this deployment yet.");
  }
}

/**
 * Starts Stripe Checkout for Pinched Pro. The plan is chosen from a fixed list — the client
 * never supplies a price — and the session carries the Clerk user id, which the webhook trusts.
 */
export async function startCheckout(input: z.input<typeof planSchema>) {
  return runAction(async () => {
    const { plan } = planSchema.parse(input);
    requireBilling();
    const session = await requireSession();
    const db = await userClient();

    const current = mustMaybe(await db.from("subscriptions").select("*").maybeSingle());
    const profile = mustMaybe(await db.from("profiles").select("stripe_customer_id").maybeSingle());
    // Already subscribed: manage it instead of buying twice.
    if (current && LIVE.has(current.status) && profile?.stripe_customer_id) {
      const portal = await stripe().billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${appUrl()}/settings#billing`,
      });
      redirect(external(portal.url));
    }

    const identity = await session.identity();
    const checkout = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceFor(plan), quantity: 1 }],
      client_reference_id: session.userId,
      ...(profile?.stripe_customer_id
        ? { customer: profile.stripe_customer_id }
        : identity.email
          ? { customer_email: identity.email }
          : {}),
      // 14-day trial with a card up front — once per person.
      payment_method_collection: "always",
      subscription_data: {
        ...(current ? {} : { trial_period_days: PRO_PRICING.trialDays }),
        metadata: { user_id: session.userId },
      },
      allow_promotion_codes: true,
      success_url: `${appUrl()}/plan?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/settings#billing`,
    });
    if (!checkout.url) throw new ActionFailure("unknown", "Stripe didn't return a checkout link.");
    redirect(external(checkout.url));
  });
}

/** Opens the Stripe Billing Portal (change plan, update card, cancel). */
export async function openBillingPortal() {
  return runAction(async () => {
    requireBilling();
    const db = await userClient();
    const profile = mustMaybe(await db.from("profiles").select("stripe_customer_id").maybeSingle());
    if (!profile?.stripe_customer_id) {
      throw new ActionFailure("not_found", "There's no billing account to manage yet.");
    }
    const portal = await stripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl()}/settings#billing`,
    });
    redirect(external(portal.url));
  });
}

const syncSchema = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/) });

/**
 * After Checkout returns to `/plan?upgraded=1`, read the session back from Stripe so Pro unlocks
 * immediately even if the webhook is a few seconds behind. The session must belong to the signed-in
 * person (its client_reference_id is the Clerk user id we sent).
 */
export async function syncCheckout(input: z.input<typeof syncSchema>) {
  return runAction(async () => {
    const { sessionId } = syncSchema.parse(input);
    requireBilling();
    const session = await requireSession();
    const checkout = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    if (checkout.client_reference_id !== session.userId) {
      throw new ActionFailure("forbidden", "That checkout doesn't belong to this account.");
    }
    const admin = adminClient();
    const customer =
      typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id;
    if (customer) await linkCustomer(admin, session.userId, customer);
    const subscription = checkout.subscription;
    if (subscription && typeof subscription !== "string") {
      await upsertSubscription(admin, mapSubscription(subscription, session.userId, priceIds()));
    }
    revalidatePath("/plan");
    revalidatePath("/settings");
    return {
      status: typeof subscription === "object" && subscription ? subscription.status : null,
    };
  });
}

// ─────────────────────────────── local demo mode ───────────────────────────────

/**
 * Local demo mode only: flip Pro on or off so the gates can be tried without Stripe. It is
 * refused anywhere but local mode, and the rows look exactly like the ones the webhook writes.
 */
export async function setLocalPro(input: { pro: boolean }) {
  return runAction(async () => {
    if (!isLocalMode()) throw new ActionFailure("forbidden", "Not available here.");
    const { pro } = z.object({ pro: z.boolean() }).parse(input);
    const session = await requireSession();
    const admin = adminClient();
    if (pro) {
      mustOk(
        await admin.from("subscriptions").upsert(
          {
            user_id: session.userId,
            stripe_subscription_id: `sub_local_${session.userId}`,
            stripe_customer_id: `cus_local_${session.userId}`,
            status: "active",
            plan: "monthly",
            price_id: "price_local",
            current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        ),
      );
    } else {
      mustOk(await admin.from("subscriptions").delete().eq("user_id", session.userId));
    }
    revalidatePath("/settings");
    revalidatePath("/plan");
    revalidatePath("/prep");
  });
}
