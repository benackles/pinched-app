import { describe, expect, it } from "vitest";

import { describePlan, type PlanSubscription } from "./summary";

const pricing = { monthly: "$5.99", yearly: "$39" };
const sub = (over: Partial<PlanSubscription> = {}): PlanSubscription => ({
  status: "active",
  plan: "monthly",
  trial_end: null,
  current_period_end: "2026-11-02T12:00:00.000Z",
  cancel_at_period_end: false,
  ...over,
});
const describe_ = (subscription: PlanSubscription | null, pro: boolean) =>
  describePlan({ pro, subscription, timeZone: "America/Los_Angeles", pricing });

describe("describePlan", () => {
  it("reads as free with no subscription", () => {
    const out = describe_(null, false);
    expect(out.badge).toEqual({ label: "Free", tone: "muted" });
    expect(out.summary).toMatch(/free plan/);
  });

  it("shows the renewal date in the person's own zone", () => {
    const out = describe_(sub(), true);
    expect(out.badge.label).toBe("Pro monthly");
    expect(out.summary).toBe("Renews on November 2, 2026.");
    // 01:00 UTC on the 3rd is still the 2nd in Los Angeles.
    const late = describe_(sub({ current_period_end: "2026-11-03T01:00:00.000Z" }), true);
    expect(late.summary).toBe("Renews on November 2, 2026.");
  });

  it("says when a cancelled plan runs out", () => {
    const out = describe_(sub({ cancel_at_period_end: true }), true);
    expect(out.summary).toBe("Pro until November 2, 2026. It won't renew.");
    expect(out.badge.tone).toBe("success");
  });

  it("describes a trial with what comes after it", () => {
    const monthly = describe_(sub({ status: "trialing", trial_end: "2026-10-14T00:00:00Z" }), true);
    expect(monthly.badge).toEqual({ label: "Free trial", tone: "accent" });
    expect(monthly.summary).toBe("Your free trial ends on October 13, 2026. Then $5.99 per month.");
    const yearly = describe_(
      sub({ status: "trialing", plan: "yearly", trial_end: "2026-10-14T20:00:00Z" }),
      true,
    );
    expect(yearly.summary).toContain("Then $39 per year.");
  });

  it("says a cancelled trial won't renew", () => {
    const out = describe_(
      sub({ status: "trialing", trial_end: "2026-10-14T20:00:00Z", cancel_at_period_end: true }),
      true,
    );
    expect(out.summary).toBe("Your free trial runs until October 14, 2026 and won't renew.");
  });

  it("warns on a failed payment without downgrading — Pro stays on while Stripe retries", () => {
    const out = describe_(sub({ status: "past_due" }), true);
    expect(out.badge).toEqual({ label: "Payment due", tone: "accent" });
    expect(out.summary).toMatch(/Pro stays on/);
  });

  it("returns to free after the subscription ends, and keeps their data", () => {
    const out = describe_(sub({ status: "canceled" }), false);
    expect(out.badge.label).toBe("Free");
    expect(out.summary).toBe(
      "Your Pro plan ended on November 2, 2026. Everything you saved is still here.",
    );
  });

  it("copes with missing dates and plans", () => {
    const out = describe_(sub({ plan: null, current_period_end: null }), true);
    expect(out.badge.label).toBe("Pro");
    expect(out.summary).toBe("Pro is on.");
    expect(describe_(sub({ status: "canceled", current_period_end: null }), false).summary).toMatch(
      /still here/,
    );
  });

  it("explains an unfinished checkout", () => {
    const out = describe_(sub({ status: "incomplete" }), false);
    expect(out.badge.label).toBe("Finishing up");
  });
});
