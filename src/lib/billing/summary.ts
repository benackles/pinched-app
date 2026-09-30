/** How a subscription reads in Settings → Pinched Pro. Pure: dates are formatted in the person's zone. */

export type PlanSubscription = {
  status: string;
  plan: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export type PlanSummary = {
  summary: string;
  badge: { label: string; tone: "success" | "muted" | "accent" };
};

function day(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(date);
}

const planName = (plan: string | null) =>
  plan === "yearly" ? "yearly" : plan === "monthly" ? "monthly" : null;

/**
 * `pro` is what the database says (`is_pro()`); the subscription row only supplies the wording.
 * Past-due keeps Pro on while Stripe retries the card, so it reads as a warning, not as a downgrade.
 */
export function describePlan(input: {
  pro: boolean;
  subscription: PlanSubscription | null;
  timeZone: string;
  pricing: { monthly: string; yearly: string };
}): PlanSummary {
  const { pro, subscription: sub, timeZone } = input;

  if (!sub) {
    return { badge: { label: "Free", tone: "muted" }, summary: "You're on the free plan." };
  }

  const name = planName(sub.plan);
  const renews = day(sub.current_period_end, timeZone);
  const trialEnds = day(sub.trial_end, timeZone);

  if (!pro) {
    if (sub.status === "incomplete") {
      return {
        badge: { label: "Finishing up", tone: "muted" },
        summary: "Your checkout hasn't finished yet. If you closed the payment page, start again.",
      };
    }
    return {
      badge: { label: "Free", tone: "muted" },
      summary: renews
        ? `Your Pro plan ended on ${renews}. Everything you saved is still here.`
        : "You're on the free plan. Everything you saved is still here.",
    };
  }

  if (sub.status === "past_due") {
    return {
      badge: { label: "Payment due", tone: "accent" },
      summary:
        "We couldn't charge your card. Pro stays on while we retry — update your card to keep it.",
    };
  }

  if (sub.status === "trialing") {
    const then = name
      ? ` Then ${input.pricing[name]} per ${name === "yearly" ? "year" : "month"}.`
      : "";
    return {
      badge: { label: "Free trial", tone: "accent" },
      summary: sub.cancel_at_period_end
        ? `Your free trial runs until ${trialEnds ?? renews ?? "the end of the period"} and won't renew.`
        : `Your free trial ends on ${trialEnds ?? renews ?? "soon"}.${then}`,
    };
  }

  const label = name ? `Pro ${name}` : "Pro";
  if (sub.cancel_at_period_end) {
    return {
      badge: { label, tone: "success" },
      summary: renews
        ? `Pro until ${renews}. It won't renew.`
        : "Pro until the end of this period. It won't renew.",
    };
  }
  return {
    badge: { label, tone: "success" },
    summary: renews ? `Renews on ${renews}.` : "Pro is on.",
  };
}
