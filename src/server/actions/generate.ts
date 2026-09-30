"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { summarizePrep } from "@/lib/domain/prep";
import { isISODate, mondayOf } from "@/lib/domain/week";
import { track } from "@/server/analytics";
import { requireSession } from "@/server/auth";
import { must, mustOk } from "@/server/db";
import { applyGroceryMerge, planGrocery, summarizeGroceryChanges } from "@/server/generate/grocery";
import {
  applyPrepMerge,
  ensurePrepPlan,
  planPrep,
  summarizePrepChanges,
} from "@/server/generate/prep";
import { getProfile } from "@/server/profile";
import { loadWeekContext } from "@/server/queries/week";
import { userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

const weekSchema = z.object({
  weekStart: z.string().refine(isISODate, "Pick a valid week.").transform(mondayOf),
});

/**
 * Builds (or rebuilds) the week's grocery list: what the plan needs minus what the kitchen has.
 * Regenerating keeps the person's edits — custom items, removed items, "already have", checked
 * items and edited quantities.
 */
export async function regenerateGrocery(input: z.input<typeof weekSchema>) {
  return runAction(async () => {
    const { weekStart } = weekSchema.parse(input);
    const db = await userClient();
    const ctx = await loadWeekContext(db, weekStart);
    if (!ctx.plan || ctx.meals.length === 0) {
      throw new ActionFailure("validation", "Add a meal to the week first.");
    }
    const { list, existing, merged } = await planGrocery(db, ctx);
    const changes = summarizeGroceryChanges(existing, merged);

    const listRow =
      list ??
      must(
        await db.from("grocery_lists").insert({ weekly_plan_id: ctx.plan.id }).select("*").single(),
      );
    await applyGroceryMerge(db, listRow.id, merged);
    mustOk(
      await db
        .from("grocery_lists")
        .update({ generated_at: new Date().toISOString() })
        .eq("id", listRow.id),
    );

    revalidatePath("/grocery-list");
    revalidatePath("/plan");
    const live = merged.items.filter((item) => !item.is_removed && !item.is_already_owned);
    // Activation (PRD): a grocery list and a prep plan in week one. Only the first build counts.
    await track((await requireSession()).userId, "grocery_generated", {
      created: list === null,
      meals: ctx.meals.length,
      items_to_buy: live.length,
    });
    return { created: list === null, toBuy: live.length, ...changes };
  });
}

/**
 * Builds (or rebuilds) the week's consolidated prep plan. Free accounts get the first two weeks;
 * regenerating keeps manual edits, completion and — once reordered — the person's order.
 */
export async function regeneratePrep(input: z.input<typeof weekSchema>) {
  return runAction(async () => {
    const { weekStart } = weekSchema.parse(input);
    const db = await userClient();
    const profile = await getProfile();
    const ctx = await loadWeekContext(db, weekStart);
    if (!ctx.plan || ctx.meals.length === 0) {
      throw new ActionFailure("validation", "Add a meal to the week first.");
    }
    const { plan, existing, merged, drafts } = await planPrep(db, ctx);

    const { plan: planRow, created } = plan
      ? { plan, created: false }
      : await ensurePrepPlan(db, ctx.plan.id, weekStart, profile.prep_day);
    const changes = summarizePrepChanges(existing, merged);
    const { totalMinutes } = await applyPrepMerge(db, planRow.id, merged);
    mustOk(
      await db
        .from("prep_plans")
        .update({ estimated_minutes: totalMinutes, generated_at: new Date().toISOString() })
        .eq("id", planRow.id),
    );

    revalidatePath("/prep");
    revalidatePath("/plan");
    const tasks = merged.tasks.filter((t) => !t.is_removed).length;
    await track((await requireSession()).userId, "prep_generated", {
      created,
      tasks,
      minutes: totalMinutes,
      saved_minutes: summarizePrep(drafts).savedMinutes,
    });
    return { created, tasks, totalMinutes, ...changes };
  });
}
