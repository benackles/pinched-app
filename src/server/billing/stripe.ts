import "server-only";

import Stripe from "stripe";

import { ConfigError } from "@/server/env";

let client: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_MONTHLY &&
    process.env.STRIPE_PRICE_YEARLY,
  );
}

/** The Stripe client. Server-only; the secret key never reaches the browser. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ConfigError("Missing STRIPE_SECRET_KEY (see .env.example).");
  return (client ??= new Stripe(key));
}

export type PlanId = "monthly" | "yearly";

export function priceIds(): { monthly?: string; yearly?: string } {
  return { monthly: process.env.STRIPE_PRICE_MONTHLY, yearly: process.env.STRIPE_PRICE_YEARLY };
}

export function priceFor(plan: PlanId): string {
  const id = priceIds()[plan];
  if (!id) throw new ConfigError(`Missing STRIPE_PRICE_${plan.toUpperCase()} (see .env.example).`);
  return id;
}

/** Pinched Pro pricing shown in the UI (the amounts charged come from the Stripe prices). */
export const PRO_PRICING = {
  monthly: { label: "$5.99", per: "month" },
  yearly: { label: "$39", per: "year" },
  trialDays: 14,
} as const;
