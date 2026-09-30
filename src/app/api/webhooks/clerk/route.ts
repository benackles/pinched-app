import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextResponse, type NextRequest } from "next/server";

import { track } from "@/server/analytics";
import { isBillingConfigured, stripe } from "@/server/billing/stripe";
import { handleClerkEvent, type ClerkUserEvent } from "@/server/clerk/webhook";
import { adminClient } from "@/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stops billing for a deleted account so nobody is charged for data that no longer exists. */
async function cancelSubscriptions(userId: string) {
  if (!isBillingConfigured()) return;
  const { data } = await adminClient()
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (data && ["trialing", "active", "past_due"].includes(data.status)) {
    await stripe().subscriptions.cancel(data.stripe_subscription_id);
  }
}

/** Clerk → profiles (created, updated, deleted). Verified with Clerk's signing secret. */
export async function POST(request: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(request);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (
    event.type !== "user.created" &&
    event.type !== "user.updated" &&
    event.type !== "user.deleted"
  ) {
    return NextResponse.json({ received: true, handled: false });
  }
  try {
    const result = await handleClerkEvent(event as unknown as ClerkUserEvent, {
      admin: adminClient(),
      cancelSubscriptions,
    });
    // Funnel start. Clerk sends user.created once per person; nothing about them is recorded.
    if (event.type === "user.created" && result.handled) {
      await track((event as unknown as ClerkUserEvent).data.id ?? "", "signed_up", {});
    }
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("[clerk webhook]", event.type, error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
