import "server-only";

import type { Row } from "@/db/types";
import {
  generatePrep,
  mergePrepRegeneration,
  type ExistingPrepTask,
  type MergedPrepTask,
  type PrepDraftTask,
  type PrepMergeResult,
} from "@/lib/domain/prep";
import { FREE_LIMITS } from "@/lib/domain/constants";
import { prepDateFor } from "@/lib/domain/week";
import { ActionFailure } from "@/server/actions/result";
import { must, mustMaybe, mustOk } from "@/server/db";
import { isPro } from "@/server/profile";
import { chunk } from "@/server/generate/grocery";
import { loadPrepState } from "@/server/queries/outputs";
import { toMealInputs, type WeekContext } from "@/server/queries/week";
import type { Supabase } from "@/server/supabase";

const toExisting = (row: Row<"prep_tasks">): ExistingPrepTask => ({
  id: row.id,
  generation_key: row.generation_key,
  title: row.title,
  description: row.description,
  minutes: row.minutes,
  is_passive: row.is_passive,
  sort_order: row.sort_order,
  is_completed: row.is_completed,
  completed_at: row.completed_at,
  is_custom: row.is_custom,
  is_edited: row.is_edited,
  is_removed: row.is_removed,
});

export type PrepPlanResult = {
  plan: Row<"prep_plans"> | null;
  existing: Row<"prep_tasks">[];
  links: { prep_task_id: string; planned_meal_id: string }[];
  drafts: PrepDraftTask[];
  merged: PrepMergeResult;
};

/** What regenerating would do, without writing anything. */
export async function planPrep(db: Supabase, ctx: WeekContext): Promise<PrepPlanResult> {
  const state = await loadPrepState(db, ctx.plan?.id ?? null);
  const drafts = generatePrep(toMealInputs(ctx.meals));
  const merged = mergePrepRegeneration(state.tasks.map(toExisting), drafts, {
    manuallyOrdered: state.plan?.is_manually_ordered ?? false,
  });
  return { plan: state.plan, existing: state.tasks, links: state.links, drafts, merged };
}

export type PrepChanges = { added: number; removed: number; changed: number };

export function summarizePrepChanges(
  existing: Row<"prep_tasks">[],
  merged: PrepMergeResult,
): PrepChanges {
  const byId = new Map(existing.map((row) => [row.id, row]));
  let added = 0;
  let changed = 0;
  for (const task of merged.tasks) {
    if (task.is_removed) continue;
    if (task.id === null) {
      added++;
      continue;
    }
    const current = byId.get(task.id);
    if (
      current &&
      (current.title !== task.title ||
        current.description !== task.description ||
        current.minutes !== task.minutes)
    ) {
      changed++;
    }
  }
  const removed = merged.deleteIds.filter((id) => {
    const row = byId.get(id);
    return row && !row.is_custom && !row.is_removed;
  }).length;
  return { added, removed, changed };
}

const toRow = (task: MergedPrepTask, planId: string) => ({
  prep_plan_id: planId,
  generation_key: task.generation_key,
  title: task.title,
  description: task.description,
  minutes: task.minutes,
  is_passive: task.is_passive,
  sort_order: task.sort_order,
  is_completed: task.is_completed,
  completed_at: task.completed_at,
  is_custom: task.is_custom,
  is_edited: task.is_edited,
  is_removed: task.is_removed,
});

/** Writes a prep merge. Same ordering and `updated_at` rules as the grocery merge. */
export async function applyPrepMerge(
  db: Supabase,
  planId: string,
  merged: PrepMergeResult,
): Promise<{ totalMinutes: number }> {
  const updates = merged.tasks.filter((task) => task.id !== null);
  const inserts = merged.tasks.filter((task) => task.id === null);

  for (const part of chunk(updates)) {
    mustOk(
      await db.from("prep_tasks").upsert(
        part.map((task) => ({ id: task.id!, ...toRow(task, planId) })),
        { onConflict: "id" },
      ),
    );
  }

  const insertedIds = new Map<string, string>();
  for (const part of chunk(inserts)) {
    const rows = must(
      await db
        .from("prep_tasks")
        .insert(part.map((task) => toRow(task, planId)))
        .select("id, generation_key"),
    );
    for (const row of rows) if (row.generation_key) insertedIds.set(row.generation_key, row.id);
  }

  const replace: { taskId: string; task: MergedPrepTask }[] = [];
  for (const task of merged.tasks) {
    if (task.meals === null) continue;
    const taskId =
      task.id ?? (task.generation_key ? insertedIds.get(task.generation_key) : undefined);
    if (taskId) replace.push({ taskId, task });
  }
  const clearIds = [...replace.map((r) => r.taskId), ...merged.clearMealsFor];
  for (const part of chunk(clearIds)) {
    mustOk(await db.from("prep_task_meals").delete().in("prep_task_id", part));
  }
  const links = replace.flatMap(({ taskId, task }) =>
    (task.meals ?? []).map((meal) => ({ prep_task_id: taskId, planned_meal_id: meal.meal_id })),
  );
  for (const part of chunk(links, 150)) {
    mustOk(await db.from("prep_task_meals").insert(part));
  }

  for (const part of chunk(merged.deleteIds)) {
    mustOk(await db.from("prep_tasks").delete().in("id", part));
  }

  const totalMinutes = merged.tasks.reduce((sum, task) => sum + task.minutes, 0);
  return { totalMinutes };
}

/**
 * The prep plan row for a week, created on first use. Free accounts get the first two weeks;
 * the database enforces that too, but checking first gives a friendly message before any work.
 */
export async function ensurePrepPlan(
  db: Supabase,
  weeklyPlanId: string,
  weekStart: string,
  prepDay: number,
): Promise<{ plan: Row<"prep_plans">; created: boolean }> {
  const existing = mustMaybe(
    await db.from("prep_plans").select("*").eq("weekly_plan_id", weeklyPlanId).maybeSingle(),
  );
  if (existing) return { plan: existing, created: false };

  if (!(await isPro())) {
    const count = must(await db.from("prep_plans").select("id")).length;
    if (count >= FREE_LIMITS.prepPlans) {
      throw new ActionFailure("free_limit", "", { feature: "prep_plans" });
    }
  }
  const plan = must(
    await db
      .from("prep_plans")
      .insert({ weekly_plan_id: weeklyPlanId, prep_date: prepDateFor(weekStart, prepDay) })
      .select("*")
      .single(),
  );
  return { plan, created: true };
}
