"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { GrocerySection } from "@/lib/domain/constants";
import { normalizeIngredientName, sentenceCase, cleanDisplayName } from "@/lib/domain/ingredients";
import { parseQuickAdd } from "@/lib/domain/quick-add";
import { uuid } from "@/lib/validation/common";
import { checkSchema, customGrocerySchema, editGrocerySchema } from "@/lib/validation/outputs";
import { must, mustOk } from "@/server/db";
import { getOrCreatePlan } from "@/server/queries/week";
import { clampToNow } from "@/server/time";
import { userClient } from "@/server/supabase";
import { classifySection } from "@/lib/domain/ingredient-data";

import { ActionFailure, runAction } from "./result";

const refresh = () => {
  revalidatePath("/grocery-list");
  revalidatePath("/plan");
};

/**
 * Check an item off (or back on). Last write wins per item, by the client's timestamp, so a
 * check-off made offline and replayed later doesn't overwrite a newer change from another device.
 */
export async function setGroceryChecked(input: z.input<typeof checkSchema>) {
  return runAction(async () => {
    const { id, checked, at } = checkSchema.parse(input);
    const when = clampToNow(at);
    const db = await userClient();
    const updated = must(
      await db
        .from("grocery_list_items")
        .update({ is_checked: checked, updated_at: when })
        .eq("id", id)
        .lte("updated_at", when)
        .select("id"),
    );
    if (updated.length === 0) {
      // Either a newer write won, or the item is gone (list regenerated / deleted).
      const exists = must(await db.from("grocery_list_items").select("id").eq("id", id));
      if (exists.length === 0)
        throw new ActionFailure("not_found", "That item is no longer on the list.");
      return { applied: false };
    }
    refresh();
    return { applied: true };
  });
}

/** "Already have": moves an item off the buy list (and back). The person's choice survives regeneration. */
export async function setGroceryOwned(input: { id: string; owned: boolean }) {
  return runAction(async () => {
    const { id, owned } = z.object({ id: uuid, owned: z.boolean() }).parse(input);
    const db = await userClient();
    mustOk(
      await db
        .from("grocery_list_items")
        .update({
          is_already_owned: owned,
          owned_reason: owned ? "user" : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id),
    );
    refresh();
  });
}

/**
 * Removes an item. A custom item is deleted; a generated one is kept as a tombstone so it
 * doesn't come back when the list regenerates.
 */
export async function removeGroceryItem(id: string) {
  return runAction(async () => {
    const itemId = uuid.parse(id);
    const db = await userClient();
    const item = must(
      await db.from("grocery_list_items").select("id, is_custom").eq("id", itemId).single(),
    );
    if (item.is_custom) {
      mustOk(await db.from("grocery_list_items").delete().eq("id", itemId));
    } else {
      mustOk(
        await db
          .from("grocery_list_items")
          .update({ is_removed: true, updated_at: new Date().toISOString() })
          .eq("id", itemId),
      );
    }
    refresh();
    return { wasCustom: item.is_custom };
  });
}

export async function restoreGroceryItem(id: string) {
  return runAction(async () => {
    const db = await userClient();
    mustOk(
      await db
        .from("grocery_list_items")
        .update({ is_removed: false, updated_at: new Date().toISOString() })
        .eq("id", uuid.parse(id)),
    );
    refresh();
  });
}

/** Adds your own item ("2 limes") to the week's list, creating the list if there isn't one yet. */
export async function addCustomGroceryItem(input: z.input<typeof customGrocerySchema>) {
  return runAction(async () => {
    const { weekStart, text, section } = customGrocerySchema.parse(input);
    const db = await userClient();
    const parsed = parseQuickAdd(text);
    if (!parsed) throw new ActionFailure("validation", "Type an item, like “2 limes”.");

    const plan = await getOrCreatePlan(db, weekStart);
    let list = must(await db.from("grocery_lists").select("id").eq("weekly_plan_id", plan.id))[0];
    if (!list) {
      list = must(
        await db.from("grocery_lists").insert({ weekly_plan_id: plan.id }).select("id").single(),
      );
    }
    // When no aisle was chosen, sort it the way the generator would.
    const chosen: GrocerySection =
      section !== "Other" ? section : classifySection(parsed.normalized_name);
    const item = must(
      await db
        .from("grocery_list_items")
        .insert({
          grocery_list_id: list.id,
          name: parsed.name,
          normalized_name: parsed.normalized_name,
          quantity: parsed.quantity,
          unit: parsed.unit,
          section: chosen,
          is_custom: true,
        })
        .select("id")
        .single(),
    );
    refresh();
    return { id: item.id };
  });
}

/** Edits an item. A generated item is marked edited so regeneration keeps the person's version. */
export async function editGroceryItem(input: z.input<typeof editGrocerySchema>) {
  return runAction(async () => {
    const data = editGrocerySchema.parse(input);
    const db = await userClient();
    const current = must(
      await db.from("grocery_list_items").select("id, is_custom").eq("id", data.id).single(),
    );
    const name = sentenceCase(cleanDisplayName(data.name)) || data.name;
    mustOk(
      await db
        .from("grocery_list_items")
        .update({
          name: name.toLowerCase(),
          normalized_name: normalizeIngredientName(data.name) || data.name.toLowerCase(),
          quantity: data.quantity,
          unit: data.unit,
          display_text: null,
          section: data.section,
          is_edited: !current.is_custom,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id),
    );
    refresh();
  });
}
