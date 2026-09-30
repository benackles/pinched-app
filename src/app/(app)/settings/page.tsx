import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/app-shell";
import {
  AccountCard,
  BillingCard,
  InstallCard,
  PrepDayCard,
  RemindersCard,
  type BillingView,
} from "@/components/settings/settings-client";
import { authMode, isLocalMode } from "@/lib/auth/config";
import { describePlan } from "@/lib/billing/summary";
import { isBillingConfigured, PRO_PRICING } from "@/server/billing/stripe";
import { currentSubscription } from "@/server/billing/subscription";
import { mustMaybe } from "@/server/db";
import { getProfile, getTimezone, isPro } from "@/server/profile";
import { loadUsage } from "@/server/queries/account";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const db = await userClient();
  const profile = await getProfile();
  const timeZone = await getTimezone(profile);
  const [pro, subscription, usage, customer] = await Promise.all([
    isPro(),
    currentSubscription(db),
    loadUsage(db, timeZone),
    db.from("profiles").select("stripe_customer_id").maybeSingle(),
  ]);
  const billingConfigured = isBillingConfigured();
  const hasCustomer = Boolean(mustMaybe(customer)?.stripe_customer_id);

  const { summary, badge } = describePlan({
    pro,
    subscription,
    timeZone,
    pricing: { monthly: PRO_PRICING.monthly.label, yearly: PRO_PRICING.yearly.label },
  });
  const billing: BillingView = {
    pro,
    summary,
    badge,
    manageable: billingConfigured && hasCustomer,
    billingConfigured,
    localMode: isLocalMode(),
    trialDays: PRO_PRICING.trialDays,
    pricing: { monthly: PRO_PRICING.monthly, yearly: PRO_PRICING.yearly },
    usage,
  };

  return (
    <>
      <PageHeader eyebrow="Your account" title="Settings" />
      <div className="mx-auto max-w-3xl space-y-6">
        <PrepDayCard prepDay={profile.prep_day} />
        <RemindersCard
          pro={pro}
          remindPrep={profile.remind_prep}
          remindDinner={profile.remind_dinner}
          time={profile.reminder_time.slice(0, 5)}
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        />
        <BillingCard view={billing} />
        <InstallCard />
        <AccountCard
          mode={authMode() === "clerk" ? "clerk" : "local"}
          name={profile.name}
          email={profile.email}
        />
      </div>
    </>
  );
}
