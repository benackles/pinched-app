import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app-shell/app-shell";
import { OfflineNote } from "@/components/common/offline-note";
import { AddMealButton } from "@/components/plan/add-meal-button";
import type { MealPick } from "@/components/plan/add-meal-dialog";
import { AddMealProvider } from "@/components/plan/add-meal-provider";
import { GenerateButtons } from "@/components/plan/generate-buttons";
import { MealCard, type MealCardData } from "@/components/plan/meal-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { generateGrocery } from "@/lib/domain/grocery";
import { generatePrep, mealPrepStatus } from "@/lib/domain/prep";
import {
  currentWeekStart,
  dayName,
  isISODate,
  mondayOf,
  shiftWeek,
  shortDate,
  todayInZone,
  weekDays,
} from "@/lib/domain/week";
import { dayOptions } from "@/lib/plan";
import { withWeek } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { getProfile, getTimezone } from "@/server/profile";
import { listKitchen, toStock } from "@/server/queries/kitchen";
import { loadGroceryState, loadPrepState } from "@/server/queries/outputs";
import { pickerRecipes } from "@/server/queries/recipes";
import { loadWeekContext, toMealInputs } from "@/server/queries/week";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "This Week" };

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card">
      <p className="font-display text-3xl font-semibold">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; upgraded?: string }>;
}) {
  const { week } = await searchParams;
  const db = await userClient();
  const profile = await getProfile();
  const tz = await getTimezone(profile);
  const today = todayInZone(tz);
  const thisWeek = currentWeekStart(tz);
  const weekStart = week && isISODate(week) ? mondayOf(week) : thisWeek;
  const isThisWeek = weekStart === thisWeek;
  const days = weekDays(weekStart);

  const ctx = await loadWeekContext(db, weekStart);
  const [grocery, prep] = await Promise.all([
    loadGroceryState(db, ctx.plan?.id ?? null),
    loadPrepState(db, ctx.plan?.id ?? null),
  ]);

  // Numbers for the stat tiles: the saved list / plan when there is one, a live preview otherwise.
  const mealInputs = toMealInputs(ctx.meals);
  let groceriesNeeded: number;
  if (grocery.list) {
    groceriesNeeded = grocery.items.filter(
      (i) => !i.is_removed && !i.is_already_owned && !i.is_checked,
    ).length;
  } else if (mealInputs.length) {
    const kitchen = await listKitchen(db);
    groceriesNeeded = generateGrocery(mealInputs, toStock(kitchen)).filter(
      (i) => !i.is_already_owned,
    ).length;
  } else groceriesNeeded = 0;

  const prepDrafts = prep.plan ? null : generatePrep(mealInputs);
  const prepTasks = prep.plan ? prep.visible.length : (prepDrafts?.length ?? 0);
  const prepMinutes = prep.plan
    ? prep.visible.reduce((sum, t) => sum + t.minutes, 0)
    : (prepDrafts ?? []).reduce((sum, t) => sum + t.minutes, 0);

  // Prep status chip per meal: the tasks that serve it, and how many are done.
  const mealsByTask = new Map<string, string[]>();
  for (const link of prep.links) {
    const list = mealsByTask.get(link.prep_task_id) ?? [];
    list.push(link.planned_meal_id);
    mealsByTask.set(link.prep_task_id, list);
  }
  const taskStates = prep.visible.map((t) => ({
    is_completed: t.is_completed,
    meal_ids: mealsByTask.get(t.id) ?? [],
  }));

  const picks: MealPick[] = (await pickerRecipes(db)).map((r) => ({
    id: r.id,
    title: r.title,
    imageUrl: r.imageUrl,
    servings: r.servings,
    totalMinutes: r.totalMinutes,
    tags: r.tags,
    inBook: r.savedId !== null,
  }));

  const dayChoices = dayOptions(weekStart);
  const defaultDate = days.includes(today) ? today : days[0]!;
  const prevHref = withWeek("/plan", shiftWeek(weekStart, -1), thisWeek);
  const nextHref = withWeek("/plan", shiftWeek(weekStart, 1), thisWeek);

  return (
    <AddMealProvider days={dayChoices} defaultDate={defaultDate} recipes={picks}>
      <PageHeader
        eyebrow={`Week of ${shortDate(weekStart)}`}
        title={isThisWeek ? "This Week" : "Week plan"}
      >
        <Link
          href={prevHref}
          aria-label="Previous week"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ChevronLeft aria-hidden />
        </Link>
        {!isThisWeek && (
          <Link href="/plan" className={buttonVariants({ variant: "outline" })}>
            This week
          </Link>
        )}
        <Link
          href={nextHref}
          aria-label="Next week"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ChevronRight aria-hidden />
        </Link>
        <AddMealButton variant="default" size="default" label="Add Meal" date={defaultDate} />
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={ctx.meals.length} label="meals planned" />
        <Stat value={groceriesNeeded} label="groceries needed" />
        <Stat value={prepTasks} label="prep tasks" />
        <Stat value={`${prepMinutes} min`} label="prep" />
      </div>

      <GenerateButtons
        weekStart={weekStart}
        hasMeals={ctx.meals.length > 0}
        groceryHref={withWeek("/grocery-list", weekStart, thisWeek)}
        prepHref={withWeek("/prep", weekStart, thisWeek)}
        groceryExists={grocery.list !== null}
        prepExists={prep.plan !== null}
      />
      <div className="-mt-5 mb-6">
        <OfflineNote what="change your week" />
      </div>

      <div className="space-y-6">
        {days.map((date) => {
          const isToday = date === today;
          const meals = ctx.meals.filter((m) => m.planned_date === date);
          return (
            <section
              key={date}
              aria-labelledby={`day-${date}`}
              className={cn("rounded-3xl p-4 md:p-5", isToday ? "bg-accent/50" : "bg-secondary/50")}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 id={`day-${date}`} className="text-2xl font-semibold">
                  {dayName(date)}{" "}
                  <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">
                    {shortDate(date)}
                  </span>
                  {isToday && (
                    <Badge variant="accent" className="ml-2 align-middle">
                      Today
                    </Badge>
                  )}
                </h2>
                <AddMealButton date={date} />
              </div>
              {meals.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {meals.map((meal) => {
                    const data: MealCardData = {
                      id: meal.id,
                      recipeId: meal.recipe_id,
                      title: meal.title,
                      imageUrl: meal.image_url,
                      mealType: meal.meal_type,
                      totalMinutes: meal.total_minutes,
                      servings: meal.servings,
                      scalable: meal.scalable,
                      hasVersion: meal.has_version,
                      date: meal.planned_date,
                      prep: (({ state, label }) => ({ state, label }))(
                        mealPrepStatus(meal.id, taskStates),
                      ),
                    };
                    return <MealCard key={meal.id} meal={data} moveTargets={dayChoices} />;
                  })}
                </div>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">Nothing planned.</p>
              )}
            </section>
          );
        })}
      </div>
    </AddMealProvider>
  );
}
