import { ChevronLeft, ChevronRight, Lock, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import {
  PrepChecklist,
  PrepDayPicker,
  PrepUpdateBanner,
  RegeneratePrepButton,
  type PrepTaskView,
} from "@/components/prep/prep-client";
import { buttonVariants } from "@/components/ui/button";
import { FREE_LIMITS } from "@/lib/domain/constants";
import { summarizePrep, usedInLabel, type PrepMealRef } from "@/lib/domain/prep";
import {
  currentWeekStart,
  dayName,
  isISODate,
  mondayOf,
  prepDateFor,
  prepDateOptions,
  shiftWeek,
  shortDate,
} from "@/lib/domain/week";
import { pluralize } from "@/lib/format";
import { withWeek } from "@/lib/routes";
import { requireSession } from "@/server/auth";
import { must } from "@/server/db";
import { planPrep, summarizePrepChanges } from "@/server/generate/prep";
import { getProfile, getTimezone, isPro } from "@/server/profile";
import { loadWeekContext } from "@/server/queries/week";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Prep Plan" };

export default async function PrepPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const session = await requireSession();
  const db = await userClient();
  const profile = await getProfile();
  const tz = await getTimezone(profile);
  const thisWeek = currentWeekStart(tz);
  const weekStart = week && isISODate(week) ? mondayOf(week) : thisWeek;

  const ctx = await loadWeekContext(db, weekStart);
  const { plan, existing, links, drafts, merged } = await planPrep(db, ctx);

  const mealById = new Map(ctx.meals.map((m) => [m.id, m]));
  const mealsByTask = new Map<string, PrepMealRef[]>();
  for (const link of links) {
    const meal = mealById.get(link.planned_meal_id);
    if (!meal) continue;
    const list = mealsByTask.get(link.prep_task_id) ?? [];
    list.push({ meal_id: meal.id, title: meal.title, day: meal.planned_date });
    mealsByTask.set(link.prep_task_id, list);
  }

  const visible = existing
    .filter((task) => !task.is_removed)
    .sort((a, b) => a.sort_order - b.sort_order);
  const tasks: PrepTaskView[] = visible.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    minutes: task.minutes,
    is_passive: task.is_passive,
    is_completed: task.is_completed,
    is_custom: task.is_custom,
    usedIn: usedInLabel(
      (mealsByTask.get(task.id) ?? []).sort((a, b) => a.day.localeCompare(b.day)),
    ),
  }));

  const minutes = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const prepDate = plan?.prep_date ?? prepDateFor(weekStart, profile.prep_day);
  const summary = summarizePrep(drafts);
  const changes = plan ? summarizePrepChanges(existing, merged) : null;
  const stale = changes && changes.added + changes.removed + changes.changed > 0;

  // Free accounts get the first two weeks; past that, creating a new plan needs Pro.
  let locked = false;
  if (!plan && ctx.meals.length > 0 && !(await isPro())) {
    locked = must(await db.from("prep_plans").select("id")).length >= FREE_LIMITS.prepPlans;
  }

  const dayChoices = prepDateOptions(weekStart).map((value) => ({
    value,
    label: `${dayName(value)} ${shortDate(value)}`,
  }));

  const prev = withWeek("/prep", shiftWeek(weekStart, -1), thisWeek);
  const next = withWeek("/prep", shiftWeek(weekStart, 1), thisWeek);

  return (
    <>
      <PageHeader
        eyebrow={
          plan
            ? `${minutes} minutes · week of ${shortDate(weekStart)}`
            : `Week of ${shortDate(weekStart)}`
        }
        title={`${dayName(prepDate)} Prep`}
      >
        <Link
          href={prev}
          aria-label="Previous week"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ChevronLeft aria-hidden />
        </Link>
        <Link
          href={next}
          aria-label="Next week"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ChevronRight aria-hidden />
        </Link>
        {plan && <RegeneratePrepButton weekStart={weekStart} label="Regenerate" />}
      </PageHeader>

      {plan && (
        <div className="-mt-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <PrepDayPicker weekStart={weekStart} value={prepDate} options={dayChoices} />
          {summary.savedMinutes > 0 && (
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Timer className="size-4" aria-hidden />
              About {summary.savedMinutes} min saved vs. prepping each recipe on its own
            </p>
          )}
        </div>
      )}

      {!plan && ctx.meals.length === 0 && (
        <EmptyState title="No prep yet.">
          <p>
            Plan a few meals and Pinched will combine the chopping, cooking and sauces into one
            session.
          </p>
          <Link href="/plan" className={buttonVariants({ className: "mt-4" })}>
            Go to your plan
          </Link>
        </EmptyState>
      )}

      {!plan && ctx.meals.length > 0 && !locked && (
        <EmptyState title={`Prep ${pluralize(ctx.meals.length, "meal")} in one session`}>
          <p>
            {drafts.length > 0
              ? `We found ${pluralize(drafts.length, "task")} — about ${summary.totalMinutes} minutes, with overlapping work combined.`
              : "We didn't find anything that can be done ahead — you can still add your own tasks."}
          </p>
          <div className="mt-4 flex justify-center">
            <RegeneratePrepButton
              weekStart={weekStart}
              label="Create prep plan"
              variant="default"
            />
          </div>
        </EmptyState>
      )}

      {locked && (
        <EmptyState title="Unlock prep for every week">
          <p className="mx-auto max-w-md">
            Free accounts build the prep plan for their first {FREE_LIMITS.prepPlans} weeks. Pinched
            Pro unlocks it for every week, plus reminders.
          </p>
          <Link href="/settings#billing" className={buttonVariants({ className: "mt-4" })}>
            <Lock aria-hidden /> See Pinched Pro
          </Link>
        </EmptyState>
      )}

      {plan && (
        <>
          {stale && changes && (
            <PrepUpdateBanner
              weekStart={weekStart}
              added={changes.added}
              removed={changes.removed}
              changed={changes.changed}
            />
          )}
          {tasks.length === 0 ? (
            <EmptyState title="Nothing to prep ahead.">
              <p>Add your own tasks, or plan more meals and regenerate.</p>
            </EmptyState>
          ) : null}
          <PrepChecklist userId={session.userId} weekStart={weekStart} tasks={tasks} />
        </>
      )}
    </>
  );
}
