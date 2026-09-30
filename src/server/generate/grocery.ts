import "server-only";

import type { Row } from "@/db/types";
import {
  generateGrocery,
  mergeGroceryRegeneration,
  type ExistingGroceryItem,
  type GroceryMergeResult,
  type MergedGroceryItem,
} from "@/lib/domain/grocery";
import type { GrocerySection, OwnedReason } from "@/lib/domain/constants";
import { must, mustOk } from "@/server/db";
import { listKitchen, toStock } from "@/server/queries/kitchen";
import { loadGroceryState } from "@/server/queries/outputs";
import { toMealInputs, type WeekContext } from "@/server/queries/week";
import type { Supabase } from "@/server/supabase";

export const chunk = <T>(items: T[], size = 80): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const toExisting = (row: Row<"grocery_list_items">): ExistingGroceryItem => ({
  id: row.id,
  generation_key: row.generation_key,
  name: row.name,
  normalized_name: row.normalized_name,
  quantity: row.quantity,
  unit: row.unit,
  display_text: row.display_text,
  section: row.section as GrocerySection,
  is_custom: row.is_custom,
  is_checked: row.is_checked,
  is_already_owned: row.is_already_owned,
  owned_reason: row.owned_reason as OwnedReason | null,
  is_removed: row.is_removed,
  is_edited: row.is_edited,
});

export type GroceryPlan = {
  list: Row<"grocery_lists"> | null;
  existing: Row<"grocery_list_items">[];
  sources: Row<"grocery_item_sources">[];
  merged: GroceryMergeResult;
};

/** What regenerating would do, without writing anything. */
export async function planGrocery(db: Supabase, ctx: WeekContext): Promise<GroceryPlan> {
  const [state, kitchen] = await Promise.all([
    loadGroceryState(db, ctx.plan?.id ?? null),
    listKitchen(db),
  ]);
  const drafts = generateGrocery(toMealInputs(ctx.meals), toStock(kitchen));
  const merged = mergeGroceryRegeneration(state.items.map(toExisting), drafts);
  return { list: state.list, existing: state.items, sources: state.sources, merged };
}

export type GroceryChanges = { added: number; removed: number; changed: number };

/** Counts what a regeneration would change, for the "your plan changed" banner. */
export function summarizeGroceryChanges(
  existing: Row<"grocery_list_items">[],
  merged: GroceryMergeResult,
): GroceryChanges {
  const byId = new Map(existing.map((row) => [row.id, row]));
  let added = 0;
  let changed = 0;
  for (const item of merged.items) {
    if (item.is_removed) continue;
    if (item.id === null) {
      added++;
      continue;
    }
    const current = byId.get(item.id);
    if (
      current &&
      (current.quantity !== item.quantity ||
        current.unit !== item.unit ||
        current.name !== item.name ||
        current.display_text !== item.display_text ||
        current.section !== item.section ||
        current.is_already_owned !== item.is_already_owned)
    ) {
      changed++;
    }
  }
  const removed = merged.deleteIds.filter((id) => {
    const row = byId.get(id);
    return row && !row.is_removed && !row.is_custom;
  }).length;
  return { added, removed, changed };
}

const toRow = (item: MergedGroceryItem, listId: string) => ({
  grocery_list_id: listId,
  generation_key: item.generation_key,
  name: item.name,
  normalized_name: item.normalized_name,
  quantity: item.quantity,
  unit: item.unit,
  display_text: item.display_text,
  section: item.section,
  is_custom: item.is_custom,
  is_checked: item.is_checked,
  is_already_owned: item.is_already_owned,
  owned_reason: item.owned_reason,
  is_removed: item.is_removed,
  is_edited: item.is_edited,
});

/**
 * Writes a merge result. PostgREST has no multi-request transaction, so the order is chosen so a
 * failure part-way leaves a valid list that the next regeneration repairs: items first, then
 * source links, then removals. Existing rows keep their `updated_at`, so an offline check-off that
 * replays later is not treated as older than a regeneration.
 */
export async function applyGroceryMerge(
  db: Supabase,
  listId: string,
  merged: GroceryMergeResult,
): Promise<void> {
  const updates = merged.items.filter((item) => item.id !== null);
  const inserts = merged.items.filter((item) => item.id === null);

  for (const part of chunk(updates)) {
    mustOk(
      await db.from("grocery_list_items").upsert(
        part.map((item) => ({ id: item.id!, ...toRow(item, listId) })),
        { onConflict: "id" },
      ),
    );
  }

  const insertedIds = new Map<string, string>();
  for (const part of chunk(inserts)) {
    const rows = must(
      await db
        .from("grocery_list_items")
        .insert(part.map((item) => toRow(item, listId)))
        .select("id, generation_key"),
    );
    for (const row of rows) if (row.generation_key) insertedIds.set(row.generation_key, row.id);
  }

  // Source links: replace for every item that has fresh ones, clear the ones the merge says to.
  const replace: { itemId: string; item: MergedGroceryItem }[] = [];
  for (const item of merged.items) {
    if (item.sources === null) continue;
    const itemId =
      item.id ?? (item.generation_key ? insertedIds.get(item.generation_key) : undefined);
    if (itemId) replace.push({ itemId, item });
  }
  const clearIds = [...replace.map((r) => r.itemId), ...merged.clearSourcesFor];
  for (const part of chunk(clearIds)) {
    mustOk(await db.from("grocery_item_sources").delete().in("grocery_list_item_id", part));
  }
  const links = replace.flatMap(({ itemId, item }) =>
    (item.sources ?? []).map((source) => ({
      grocery_list_item_id: itemId,
      planned_meal_id: source.planned_meal_id,
      ingredient_id: source.ingredient_id,
      quantity: source.quantity,
      unit: source.unit,
    })),
  );
  for (const part of chunk(links, 150)) {
    mustOk(await db.from("grocery_item_sources").insert(part));
  }

  for (const part of chunk(merged.deleteIds)) {
    mustOk(await db.from("grocery_list_items").delete().in("id", part));
  }
}
