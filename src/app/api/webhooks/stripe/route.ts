import { NextResponse } from "next/server";

import { priceIds, stripe } from "@/server/billing/stripe";
import { handleStripeEvent } from "@/server/billing/webhook";
import { adminClient } from "@/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe → subscriptions. The signature is verified against the RAW body before anything is
 * parsed or written; an unsigned or tampered request gets a 400 and touches nothing.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await request.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, {
      admin: adminClient(),
      stripe: stripe(),
      prices: priceIds(),
    });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // A 500 makes Stripe retry — every write is an idempotent upsert, so retrying is safe.
    console.error("[stripe webhook]", event.type, error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
