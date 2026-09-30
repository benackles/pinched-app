import { ArrowLeft, Clock, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CookChecklists,
  CookFinish,
  PrepDoneCard,
  type CookIngredient,
} from "@/components/cook/cook-client";
import { RecipeImage } from "@/components/recipes/recipe-image";
import { suggestDeductions } from "@/lib/domain/deductions";
import { formatIngredient } from "@/lib/domain/ingredients";
import { scaleFactor, scaleIngredient } from "@/lib/domain/scaling";
import { dayName, todayInZone } from "@/lib/domain/week";
import { formatMinutes } from "@/lib/format";
import { uuid } from "@/lib/validation/common";
import { must } from "@/server/db";
import { getTimezone } from "@/server/profile";
import { listKitchen } from "@/server/queries/kitchen";
import { loadPrepState } from "@/server/queries/outputs";
import { loadMealById } from "@/server/queries/week";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Cook" };

export default async function CookPage({ params }: { params: Promise<{ mealId: string }> }) {
  const { mealId } = await params;
  if (!uuid.safeParse(mealId).success) notFound();

  const db = await userClient();
  const found = await loadMealById(db, mealId);
  if (!found) notFound();
  const { ctx, meal } = found;
  const today = todayInZone(await getTimezone());

  const [prep, kitchen, events] = await Promise.all([
    loadPrepState(db, ctx.plan?.id ?? null),
    listKitchen(db),
    db
      .from("cooking_events")
      .select("cooked_at")
      .eq("planned_meal_id", mealId)
      .order("cooked_at", { ascending: false }),
  ]);

  // Scaled to the servings planned for this meal (unchanged when the recipe's yield is unknown).
  const factor = scaleFactor(meal.recipe.servings, meal.servings);
  const ingredients: CookIngredient[] = [];
  let previous = "";
  meal.recipe.ingredients.forEach((ingredient, index) => {
    const text = formatIngredient(scaleIngredient(ingredient, factor));
    if (ingredient.quantity === null && text === previous) return;
    previous = text;
    ingredients.push({ key: `${index}`, text, group: null });
  });

  const linkedTaskIds = new Set(
    prep.links.filter((link) => link.planned_meal_id === mealId).map((link) => link.prep_task_id),
  );
  const prepTasks = prep.visible
    .filter((task) => linkedTaskIds.has(task.id))
    .map((task) => ({ id: task.id, title: task.title, done: task.is_completed }));

  const cookedOn = must(events).map((event) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      new Date(event.cooked_at),
    ),
  );

  return (
    <>
      <Link
        href="/plan"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> This week
      </Link>

      <div className="grid gap-8 md:grid-cols-[1fr_1.2fr]">
        <RecipeImage
          src={meal.image_url}
          alt={meal.title}
          title={meal.title}
          priority
          className="aspect-[4/3] w-full rounded-3xl shadow-lift"
        />
        <div className="flex flex-col justify-center gap-5">
          <div>
            <p className="text-sm font-semibold tracking-wider text-primary-strong uppercase">
              {dayName(meal.planned_date)} {meal.meal_type}
            </p>
            <h1 className="mt-1 text-4xl leading-tight font-semibold md:text-5xl">{meal.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              {meal.total_minutes != null && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" aria-hidden /> {formatMinutes(meal.total_minutes)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4" aria-hidden /> Cooking for {meal.servings}
              </span>
              <Link
                href={`/recipes/${meal.recipe_id}`}
                className="font-medium underline underline-offset-2"
              >
                Recipe details
              </Link>
            </div>
          </div>
          <PrepDoneCard tasks={prepTasks} />
          <CookFinish
            recipeId={meal.recipe_id}
            plannedMealId={meal.id}
            today={today}
            cookedOn={cookedOn}
            suggestions={suggestDeductions(meal.recipe, meal.servings, kitchen)}
          />
        </div>
      </div>

      <div className="mt-10">
        <CookChecklists
          ingredients={ingredients}
          steps={meal.recipe.steps.map((step) => step.instruction)}
        />
      </div>
    </>
  );
}
