"use client";

import { useClerk } from "@clerk/nextjs";
import { Bell, BellOff, Check, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { InstallGuide, useInstall } from "@/components/pwa/install-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/form-controls";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { toastError, unwrap } from "@/lib/actions/client";
import { PREP_DAYS } from "@/lib/domain/constants";
import {
  getPushStatus,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushStatus,
} from "@/lib/push/client";
import { cn } from "@/lib/utils";
import { openBillingPortal, setLocalPro, startCheckout } from "@/server/actions/billing";
import {
  removePushSubscription,
  savePushSubscription,
  updateSettings,
} from "@/server/actions/settings";

export function Card({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="scroll-mt-24 rounded-2xl bg-card p-6 shadow-card"
    >
      <h2 id={id ? `${id}-title` : undefined} className="text-2xl font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ─────────────────────────────── account ───────────────────────────────

function ClerkManageButton() {
  const clerk = useClerk();
  return (
    <Button variant="outline" onClick={() => clerk.openUserProfile()}>
      Manage account
    </Button>
  );
}

export function AccountCard({
  mode,
  name,
  email,
}: {
  mode: "clerk" | "local";
  name: string | null;
  email: string | null;
}) {
  return (
    <Card id="account" title="Account">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
        {name && (
          <>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{name}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Email</dt>
        <dd className="font-medium break-all">{email ?? "—"}</dd>
      </dl>
      <div className="mt-5">
        {mode === "clerk" ? (
          <ClerkManageButton />
        ) : (
          <p className="text-sm text-muted-foreground">
            This is a local demo account: nothing here leaves this computer.
          </p>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────── planning ───────────────────────────────

export function PrepDayCard({ prepDay }: { prepDay: number }) {
  const [pending, start] = useTransition();
  return (
    <Card
      id="planning"
      title="Prep day"
      description="Pinched plans your prep session for this day. You can move any week's session from the Prep screen."
    >
      <div className="max-w-xs space-y-2">
        <Label htmlFor="prep-day-setting">Usual prep day</Label>
        <NativeSelect
          id="prep-day-setting"
          defaultValue={String(prepDay)}
          disabled={pending}
          onChange={(event) =>
            start(async () => {
              unwrap(
                await updateSettings({ prep_day: Number(event.target.value) as 1 | 5 | 6 | 7 }),
                "Prep day saved",
              );
            })
          }
        >
          {PREP_DAYS.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </Card>
  );
}

// ─────────────────────────────── reminders ───────────────────────────────

export function RemindersCard({
  pro,
  remindPrep,
  remindDinner,
  time,
  vapidPublicKey,
}: {
  pro: boolean;
  remindPrep: boolean;
  remindDinner: boolean;
  /** "HH:MM" */
  time: string;
  vapidPublicKey: string | null;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const refresh = useCallback(() => {
    void getPushStatus().then(setStatus);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!pro) {
    return (
      <Card
        id="reminders"
        title="Reminders"
        description="A nudge when it's prep day, and a heads-up about tonight's dinner."
      >
        <p className="rounded-xl bg-secondary p-4 text-sm">
          Push reminders are part of Pinched Pro.{" "}
          <a href="#billing" className="font-semibold text-foreground underline underline-offset-2">
            See Pro
          </a>
        </p>
      </Card>
    );
  }

  const on = status?.state === "on";

  function enable() {
    if (!vapidPublicKey) {
      toast.error("Push isn't configured on this deployment yet.");
      return;
    }
    start(async () => {
      try {
        const payload = await subscribeThisDevice(vapidPublicKey);
        unwrap(await savePushSubscription(payload), "Reminders are on for this device");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't turn reminders on.");
      }
      refresh();
    });
  }

  function disable() {
    start(async () => {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint)
        unwrap(await removePushSubscription({ endpoint }), "Reminders are off for this device");
      refresh();
    });
  }

  return (
    <Card
      id="reminders"
      title="Reminders"
      description="Sent to devices where you turn them on. Opt-in only."
    >
      <div className="space-y-5">
        <ToggleRow
          label="Prep-day reminder"
          hint="On your prep day, with how long the session will take."
          checked={remindPrep}
          onChange={(value) =>
            start(async () => void unwrap(await updateSettings({ remind_prep: value })))
          }
          disabled={pending}
        />
        <ToggleRow
          label="Tonight's dinner"
          hint="What's planned for dinner, at the time below."
          checked={remindDinner}
          onChange={(value) =>
            start(async () => void unwrap(await updateSettings({ remind_dinner: value })))
          }
          disabled={pending}
        />
        <div className="max-w-xs space-y-2">
          <Label htmlFor="reminder-time">Remind me at</Label>
          <Input
            id="reminder-time"
            type="time"
            defaultValue={time}
            disabled={pending}
            onBlur={(event) => {
              const value = event.target.value;
              if (value && value !== time)
                start(
                  async () =>
                    void unwrap(await updateSettings({ reminder_time: value }), "Time saved"),
                );
            }}
          />
        </div>

        <div className="rounded-xl bg-secondary p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {on ? (
              <Bell className="size-4" aria-hidden />
            ) : (
              <BellOff className="size-4" aria-hidden />
            )}
            This device: {on ? "reminders on" : "reminders off"}
          </p>
          {status?.state === "needs-install" && (
            <div className="mt-3 space-y-3 text-sm">
              <p>On iPhone and iPad, reminders work once Pinched is on your Home Screen.</p>
              <InstallGuide />
            </div>
          )}
          {status?.state === "blocked" && (
            <p className="mt-2 text-sm">
              Notifications are blocked for this site. Allow them in your browser settings, then
              come back.
            </p>
          )}
          {status?.state === "unsupported" && <p className="mt-2 text-sm">{status.reason}</p>}
          {(status?.state === "off" || status?.state === "on") && (
            <div className="mt-3">
              {on ? (
                <Button variant="outline" size="sm" onClick={disable} disabled={pending}>
                  Turn off on this device
                </Button>
              ) : (
                <Button size="sm" onClick={enable} disabled={pending}>
                  Turn on for this device
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = `toggle-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} defaultChecked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

// ─────────────────────────────── billing ───────────────────────────────

export type BillingView = {
  pro: boolean;
  /** Human status for the plan line. */
  summary: string;
  badge: { label: string; tone: "success" | "muted" | "accent" };
  manageable: boolean;
  billingConfigured: boolean;
  localMode: boolean;
  trialDays: number;
  pricing: { monthly: { label: string; per: string }; yearly: { label: string; per: string } };
  usage: {
    savedRecipes: { used: number; limit: number };
    imports: { used: number; limit: number };
    prepPlans: { used: number; limit: number };
  };
};

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className={cn("font-medium", used >= limit && "text-destructive")}>
          {used} of {limit}
        </span>
      </div>
      <Progress value={percent} className="h-2" aria-label={`${label}: ${used} of ${limit} used`} />
    </div>
  );
}

export function BillingCard({ view }: { view: BillingView }) {
  const [pending, start] = useTransition();

  const checkout = (plan: "monthly" | "yearly") =>
    start(async () => {
      // A successful start redirects to Stripe; only failures come back here.
      const result = await startCheckout({ plan });
      if (result && !result.ok) toastError(result.error);
    });
  const portal = () =>
    start(async () => {
      const result = await openBillingPortal();
      if (result && !result.ok) toastError(result.error);
    });

  return (
    <Card id="billing" title="Pinched Pro">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={view.badge.tone}>{view.badge.label}</Badge>
        <p className="text-sm">{view.summary}</p>
      </div>

      {view.pro ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {view.manageable && (
            <Button variant="outline" onClick={portal} disabled={pending}>
              Manage plan
            </Button>
          )}
          {view.localMode && !view.billingConfigured && (
            <Button
              variant="ghost"
              onClick={() => start(async () => void unwrap(await setLocalPro({ pro: false })))}
              disabled={pending}
            >
              Switch to Free (demo)
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
            {[
              "Unlimited saved recipes and URL imports",
              "The prep plan for every week",
              "Push reminders",
              "Unlimited photos and video",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="size-4 shrink-0 text-success-strong" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <PlanTile
              title="Yearly"
              price={view.pricing.yearly.label}
              per={view.pricing.yearly.per}
              note="Best value — about 45% less"
              onClick={() => checkout("yearly")}
              disabled={pending || !view.billingConfigured}
              trialDays={view.trialDays}
              highlight
            />
            <PlanTile
              title="Monthly"
              price={view.pricing.monthly.label}
              per={view.pricing.monthly.per}
              onClick={() => checkout("monthly")}
              disabled={pending || !view.billingConfigured}
              trialDays={view.trialDays}
            />
          </div>
          {!view.billingConfigured && (
            <p className="mt-3 text-sm text-muted-foreground">
              {view.localMode
                ? "Checkout needs Stripe keys. In this local demo you can flip Pro on to try the gates."
                : "Billing isn't set up on this deployment yet."}
            </p>
          )}
          {view.localMode && !view.billingConfigured && (
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() =>
                start(async () => void unwrap(await setLocalPro({ pro: true }), "Pro is on (demo)"))
              }
              disabled={pending}
            >
              Try Pro locally (demo)
            </Button>
          )}
          <div className="mt-6 space-y-3 border-t pt-5">
            <h3 className="font-sans text-sm font-semibold">Your free plan</h3>
            <UsageRow
              label="Saved recipes"
              used={view.usage.savedRecipes.used}
              limit={view.usage.savedRecipes.limit}
            />
            <UsageRow
              label="URL imports this month"
              used={view.usage.imports.used}
              limit={view.usage.imports.limit}
            />
            <UsageRow
              label="Weeks with a prep plan"
              used={view.usage.prepPlans.used}
              limit={view.usage.prepPlans.limit}
            />
          </div>
        </>
      )}
    </Card>
  );
}

function PlanTile({
  title,
  price,
  per,
  note,
  onClick,
  disabled,
  trialDays,
  highlight,
}: {
  title: string;
  price: string;
  per: string;
  note?: string;
  onClick: () => void;
  disabled: boolean;
  trialDays: number;
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-2xl border p-5", highlight && "border-primary-strong")}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1">
        <span className="font-display text-3xl font-semibold">{price}</span>
        <span className="text-sm text-muted-foreground"> / {per}</span>
      </p>
      {note && <p className="mt-1 text-xs font-semibold text-primary-strong">{note}</p>}
      <Button
        className="mt-4 w-full"
        variant={highlight ? "default" : "outline"}
        onClick={onClick}
        disabled={disabled}
      >
        Start {trialDays}-day free trial
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">Card required. Cancel any time.</p>
    </div>
  );
}

// ─────────────────────────────── install ───────────────────────────────

export function InstallCard() {
  const install = useInstall();
  const [pending, start] = useTransition();
  return (
    <Card
      id="app"
      title="Install the app"
      description="Open Pinched in its own window, straight to your week — and get reminders."
    >
      {install.installed ? (
        <p className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="size-4" aria-hidden /> Pinched is installed on this device.
        </p>
      ) : install.canPrompt ? (
        <Button
          onClick={() =>
            start(async () => {
              await install.prompt();
            })
          }
          disabled={pending}
        >
          Install Pinched
        </Button>
      ) : install.ios ? (
        <InstallGuide />
      ) : (
        <p className="text-sm text-muted-foreground">
          Your browser&apos;s menu has an “Install” or “Add to Home Screen” option when it&apos;s
          available for this site.
        </p>
      )}
    </Card>
  );
}
