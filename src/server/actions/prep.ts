"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { PrepEditSnapshot } from "@/lib/domain/types";
import { isISODate, prepDateOptions } from "@/lib/domain/week";
import { uuid } from "@/lib/validation/common";
import {
  addPrepTaskSchema,
  completeSchema,
  editPrepTaskSchema,
  weekSchema,
} from "@/lib/validation/outputs";
import { must, mustOk } from "@/server/db";
import { getProfile } from "@/server/profile";
import { ensurePrepPlan } from "@/server/generate/prep";
import { loadPrepState } from "@/server/queries/outputs";
import { getOrCreatePlan } from "@/server/queries/week";
import { userClient, type Supabase } from "@/server/supabase";
import { clampToNow } from "@/server/time";

import { ActionFailure, runAction } from "./result";

const refresh = () => {
  revalidatePath("/prep");
  revalidatePath("/plan");
};

type EditAction = "add" | "edit" | "delete" | "reorder" | "complete" | "uncomplete" | "change_day";

/** Every manual prep edit is logged — signal for a later AI grouping pass (PRD). Never blocks the edit. */
async function logEdit(
  db: Supabase,
  entry: {
    planId: string;
    taskId: string | null;
    action: EditAction;
    before?: PrepEditSnapshot | null;
    after?: PrepEditSnapshot | null;
  },
) {
  const { error } = await db.from("prep_edit_log").insert({
    prep_plan_id: entry.planId,
    prep_task_id: entry.taskId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
  if (error) console.error("[prep] could not log edit", error.message);
}

async function syncMinutes(db: Supabase, planId: string) {
  const tasks = must(
    await db
      .from("prep_tasks")
      .select("minutes")
      .eq("prep_plan_id", planId)
      .eq("is_removed", false),
  );
  mustOk(
    await db
      .from("prep_plans")
      .update({ estimated_minutes: tasks.reduce((sum, t) => sum + t.minutes, 0) })
      .eq("id", planId),
  );
}

/** Tick a prep task (or untick). Last write wins per task, by the client's timestamp. */
export async function setPrepTaskCompleted(input: z.input<typeof completeSchema>) {
  return runAction(async () => {
    const { id, completed, at } = completeSchema.parse(input);
    const when = clampToNow(at);
    const db = await userClient();
    const updated = must(
      await db
        .from("prep_tasks")
        .update({
          is_completed: completed,
          completed_at: completed ? when : null,
          updated_at: when,
        })
        .eq("id", id)
        .lte("updated_at", when)
        .select("id, prep_plan_id"),
    );
    const row = updated[0];
    if (!row) {
      const exists = must(await db.from("prep_tasks").select("id").eq("id", id));
      if (exists.length === 0)
        throw new ActionFailure("not_found", "That task is no longer in the plan.");
      return { applied: false };
    }
    await logEdit(db, {
      planId: row.prep_plan_id,
      taskId: id,
      action: completed ? "complete" : "uncomplete",
      after: { is_completed: completed },
    });
    refresh();
    return { applied: true };
  });
}

/** Adds the person's own task; creates the prep plan (empty) when there isn't one yet. */
export async function addPrepTask(input: z.input<typeof addPrepTaskSchema>) {
  return runAction(async () => {
    const { weekStart, ...fields } = addPrepTaskSchema.parse(input);
    const db = await userClient();
    const profile = await getProfile();
    const weekPlan = await getOrCreatePlan(db, weekStart);
    // Prep failure never blocks the user: an empty plan still takes manual tasks.
    const { plan } = await ensurePrepPlan(db, weekPlan.id, weekStart, profile.prep_day);
    const state = await loadPrepState(db, weekPlan.id);
    const last = state.visible[state.visible.length - 1];
    const task = must(
      await db
        .from("prep_tasks")
        .insert({
          prep_plan_id: plan.id,
          title: fields.title,
          description: fields.description,
          minutes: fields.minutes,
          sort_order: (last?.sort_order ?? -1) + 1,
          is_custom: true,
        })
        .select("id")
        .single(),
    );
    await logEdit(db, {
      planId: plan.id,
      taskId: task.id,
      action: "add",
      after: { title: fields.title, description: fields.description, minutes: fields.minutes },
    });
    await syncMinutes(db, plan.id);
    refresh();
    return { id: task.id };
  });
}

/** Edits a task. A generated task is marked edited, so regeneration keeps the person's wording and minutes. */
export async function editPrepTask(input: z.input<typeof editPrepTaskSchema>) {
  return runAction(async () => {
    const data = editPrepTaskSchema.parse(input);
    const db = await userClient();
    const before = must(
      await db
        .from("prep_tasks")
        .select("id, prep_plan_id, title, description, minutes, is_custom")
        .eq("id", data.id)
        .single(),
    );
    mustOk(
      await db
        .from("prep_tasks")
        .update({
          title: data.title,
          description: data.description,
          minutes: data.minutes,
          is_edited: !before.is_custom,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id),
    );
    await logEdit(db, {
      planId: before.prep_plan_id,
      taskId: data.id,
      action: "edit",
      before: { title: before.title, description: before.description, minutes: before.minutes },
      after: { title: data.title, description: data.description, minutes: data.minutes },
    });
    await syncMinutes(db, before.prep_plan_id);
    refresh();
  });
}

/** Deletes a task. A generated one is kept as a tombstone so regenerating doesn't bring it back. */
export async function deletePrepTask(id: string) {
  return runAction(async () => {
    const taskId = uuid.parse(id);
    const db = await userClient();
    const task = must(
      await db
        .from("prep_tasks")
        .select("id, prep_plan_id, title, minutes, is_custom")
        .eq("id", taskId)
        .single(),
    );
    if (task.is_custom) mustOk(await db.from("prep_tasks").delete().eq("id", taskId));
    else {
      mustOk(
        await db
          .from("prep_tasks")
          .update({ is_removed: true, updated_at: new Date().toISOString() })
          .eq("id", taskId),
      );
    }
    await logEdit(db, {
      planId: task.prep_plan_id,
      taskId: task.is_custom ? null : taskId,
      action: "delete",
      before: { title: task.title, minutes: task.minutes },
    });
    await syncMinutes(db, task.prep_plan_id);
    refresh();
    return { wasCustom: task.is_custom };
  });
}

/** Un-deletes a generated task (the "Undo" after delete). */
export async function restorePrepTask(id: string) {
  return runAction(async () => {
    const taskId = uuid.parse(id);
    const db = await userClient();
    const task = must(
      await db
        .from("prep_tasks")
        .update({ is_removed: false, updated_at: new Date().toISOString() })
        .eq("id", taskId)
        .select("prep_plan_id"),
    );
    if (task[0]) await syncMinutes(db, task[0].prep_plan_id);
    refresh();
  });
}

/** Moves a task one place up or down. Once reordered, regeneration keeps the person's order. */
export async function movePrepTask(input: { id: string; direction: "up" | "down" }) {
  return runAction(async () => {
    const { id, direction } = z
      .object({ id: uuid, direction: z.enum(["up", "down"]) })
      .parse(input);
    const db = await userClient();
    const task = must(await db.from("prep_tasks").select("id, prep_plan_id").eq("id", id).single());
    const siblings = must(
      await db
        .from("prep_tasks")
        .select("id, sort_order")
        .eq("prep_plan_id", task.prep_plan_id)
        .eq("is_removed", false)
        .order("sort_order")
        .order("created_at"),
    );
    const index = siblings.findIndex((t) => t.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    // Write a clean 0..n-1 order so ties and gaps can't accumulate.
    const order = siblings.map((t) => t.id);
    [order[index], order[target]] = [order[target]!, order[index]!];
    for (let position = 0; position < order.length; position++) {
      const current = siblings.find((t) => t.id === order[position])!;
      if (current.sort_order !== position) {
        mustOk(await db.from("prep_tasks").update({ sort_order: position }).eq("id", current.id));
      }
    }
    mustOk(
      await db.from("prep_plans").update({ is_manually_ordered: true }).eq("id", task.prep_plan_id),
    );
    await logEdit(db, {
      planId: task.prep_plan_id,
      taskId: id,
      action: "reorder",
      after: { sort_order: target },
    });
    refresh();
  });
}

/** Moves the prep session to another day around the week (three days before through the last day). */
export async function changePrepDay(input: { weekStart: string; date: string }) {
  return runAction(async () => {
    const { weekStart } = weekSchema.parse({ weekStart: input.weekStart });
    if (!isISODate(input.date) || !prepDateOptions(weekStart).includes(input.date)) {
      throw new ActionFailure("validation", "Pick a day near that week.");
    }
    const db = await userClient();
    const plan = await getOrCreatePlan(db, weekStart);
    const updated = must(
      await db
        .from("prep_plans")
        .update({ prep_date: input.date })
        .eq("weekly_plan_id", plan.id)
        .select("id"),
    );
    if (updated.length === 0) {
      throw new ActionFailure("not_found", "Create the prep plan first.");
    }
    await logEdit(db, { planId: updated[0]!.id, taskId: null, action: "change_day" });
    refresh();
  });
}
