"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { mondayOf } from "@/lib/domain/week";
import { uuid } from "@/lib/validation/common";
import { addMealSchema, updateMealSchema } from "@/lib/validation/plan";
import { must, mustOk } from "@/server/db";
import { getOrCreatePlan } from "@/server/queries/week";
import { ensureSaved } from "@/server/recipes/content";
import { userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

const refresh = () => {
  revalidatePath("/plan");
  revalidatePath("/grocery-list");
  revalidatePath("/prep");
};

/** Adds a recipe to a day. The recipe joins the book if it isn't there yet. */
export async function addMeal(input: z.input<typeof addMealSchema>) {
  return runAction(async () => {
    const data = addMealSchema.parse(input);
    const db = await userClient();
    const savedId = await ensureSaved(db, data.recipeId);
    const plan = await getOrCreatePlan(db, mondayOf(data.date));

    const sameDay = must(
      await db
        .from("planned_meals")
        .select("sort_order")
        .eq("weekly_plan_id", plan.id)
        .eq("planned_date", data.date)
        .order("sort_order", { ascending: false })
        .limit(1),
    );
    const meal = must(
      await db
        .from("planned_meals")
        .insert({
          weekly_plan_id: plan.id,
          saved_recipe_id: savedId,
          planned_date: data.date,
          meal_type: data.mealType,
          servings: data.servings,
          sort_order: (sameDay[0]?.sort_order ?? -1) + 1,
        })
        .select("id")
        .single(),
    );
    refresh();
    revalidatePath(`/recipes/${data.recipeId}`);
    return { mealId: meal.id, weekStart: plan.week_start_date };
  });
}

/** Changes servings, moves a meal to another day of its week, or changes its meal type. */
export async function updateMeal(input: z.input<typeof updateMealSchema>) {
  return runAction(async () => {
    const data = updateMealSchema.parse(input);
    const db = await userClient();
    const current = must(
      await db
        .from("planned_meals")
        .select("id, planned_date, weekly_plan_id")
        .eq("id", data.mealId)
        .single(),
    );
    const patch: { servings?: number; planned_date?: string; meal_type?: string } = {};
    if (data.servings !== undefined) patch.servings = data.servings;
    if (data.mealType !== undefined) patch.meal_type = data.mealType;
    if (data.date !== undefined && data.date !== current.planned_date) {
      const plan = must(
        await db
          .from("weekly_plans")
          .select("week_start_date")
          .eq("id", current.weekly_plan_id)
          .single(),
      );
      if (mondayOf(data.date) !== plan.week_start_date) {
        throw new ActionFailure("validation", "Meals can move to another day of the same week.");
      }
      patch.planned_date = data.date;
    }
    const updated = must(
      await db.from("planned_meals").update(patch).eq("id", data.mealId).select("id"),
    );
    if (updated.length !== 1) throw new ActionFailure("not_found", "We couldn't find that meal.");
    refresh();
  });
}

export async function removeMeal(mealId: string) {
  return runAction(async () => {
    const db = await userClient();
    mustOk(await db.from("planned_meals").delete().eq("id", uuid.parse(mealId)));
    refresh();
  });
}
