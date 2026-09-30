import "server-only";

import type { Row } from "@/db/types";
import { must, mustMaybe } from "@/server/db";
import type { Supabase } from "@/server/supabase";

export type GroceryState = {
  list: Row<"grocery_lists"> | null;
  items: Row<"grocery_list_items">[];
  sources: Row<"grocery_item_sources">[];
};

/** The saved grocery list for a plan (if generated), with its items and source links. */
export async function loadGroceryState(db: Supabase, planId: string | null): Promise<GroceryState> {
  if (!planId) return { list: null, items: [], sources: [] };
  const list = mustMaybe(
    await db.from("grocery_lists").select("*").eq("weekly_plan_id", planId).maybeSingle(),
  );
  if (!list) return { list: null, items: [], sources: [] };
  const items = must(
    await db
      .from("grocery_list_items")
      .select("*")
      .eq("grocery_list_id", list.id)
      .order("created_at")
      .order("name"),
  );
  const sources =
    items.length === 0
      ? []
      : must(
          await db
            .from("grocery_item_sources")
            .select("*")
            .in(
              "grocery_list_item_id",
              items.map((i) => i.id),
            ),
        );
  return { list, items, sources };
}

export type PrepState = {
  plan: Row<"prep_plans"> | null;
  /** Every task row, including deleted-generated tombstones (regeneration needs them). */
  tasks: Row<"prep_tasks">[];
  /** What the person sees: tombstones removed. */
  visible: Row<"prep_tasks">[];
  links: Pick<Row<"prep_task_meals">, "prep_task_id" | "planned_meal_id">[];
};

export async function loadPrepState(db: Supabase, planId: string | null): Promise<PrepState> {
  if (!planId) return { plan: null, tasks: [], visible: [], links: [] };
  const plan = mustMaybe(
    await db.from("prep_plans").select("*").eq("weekly_plan_id", planId).maybeSingle(),
  );
  if (!plan) return { plan: null, tasks: [], visible: [], links: [] };
  const tasks = must(
    await db
      .from("prep_tasks")
      .select("*")
      .eq("prep_plan_id", plan.id)
      .order("sort_order")
      .order("created_at"),
  );
  const links =
    tasks.length === 0
      ? []
      : must(
          await db
            .from("prep_task_meals")
            .select("prep_task_id, planned_meal_id")
            .in(
              "prep_task_id",
              tasks.map((t) => t.id),
            ),
        );
  return { plan, tasks, visible: tasks.filter((t) => !t.is_removed), links };
}
