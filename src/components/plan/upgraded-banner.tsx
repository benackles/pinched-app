"use client";

import { PartyPopper } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { syncCheckout } from "@/server/actions/billing";

/**
 * Shown when Stripe Checkout returns to `/plan?upgraded=1&session_id=…`. The session is read back
 * from Stripe (so Pro unlocks even if the webhook is a few seconds behind), the page re-renders with
 * the new plan, and the address bar is tidied without re-rendering so the welcome stays put.
 */
export function UpgradedBanner({ sessionId, pro }: { sessionId: string | null; pro: boolean }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (pro) {
      window.history.replaceState(null, "", "/plan");
      return;
    }
    if (!sessionId) return;
    let cancelled = false;
    void syncCheckout({ sessionId }).then((result) => {
      if (cancelled) return;
      if (result.ok) router.refresh();
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pro, sessionId, router]);

  // `?upgraded=1` without a checkout to confirm, and not on Pro: nothing to celebrate or wait for.
  if (!pro && !sessionId) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-center gap-3 rounded-2xl bg-accent p-4 text-accent-foreground"
    >
      <PartyPopper className="size-5 shrink-0" aria-hidden />
      <p className="text-sm font-medium">
        {pro
          ? "Welcome to Pinched Pro — the prep plan for every week, reminders and unlimited recipes are on."
          : failed
            ? "We couldn't confirm your upgrade yet. It can take a minute — reload this page, or check Settings."
            : "Finishing your upgrade…"}
      </p>
    </div>
  );
}
