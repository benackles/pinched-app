"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { cleanDisplayName, normalizeIngredientName, sentenceCase } from "@/lib/domain/ingredients";
import { parseQuickAddLines } from "@/lib/domain/quick-add";
import { compatibleUnits, fromBase, toBase, unitKind } from "@/lib/domain/units";
import type { KitchenLocation } from "@/lib/domain/constants";
import { uuid } from "@/lib/validation/common";
import {
  kitchenItemSchema,
  quickAddSchema,
  updateKitchenItemSchema,
} from "@/lib/validation/kitchen";
import { must, mustOk } from "@/server/db";
import { userClient, type Supabase } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

const refresh = () => {
  revalidatePath("/kitchen");
  revalidatePath("/plan");
  revalidatePath("/grocery-list");
};

type NewItem = {
  name: string;
  normalized_name: string;
  quantity: number | null;
  unit: string | null;
  location: KitchenLocation;
};

/**
 * Adds an item. If the kitchen already has it in the same place, the amounts are added when both
 * are measured in a compatible unit; otherwise the existing row is left alone (no duplicates, no
 * guessing). Returns what happened so the UI can say so.
 */
async function addOrMerge(db: Supabase, item: NewItem): Promise<"added" | "merged" | "had"> {
  const existing = must(
    await db
      .from("kitchen_items")
      .select("*")
      .eq("normalized_name", item.normalized_name)
      .eq("location", item.location),
  );
  const match = existing.find(
    (row) =>
      row.quantity === null ||
      item.quantity === null ||
      (row.quantity > 0 && compatibleUnits(row.unit, item.unit)),
  );
  if (!match) {
    mustOk(await db.from("kitchen_items").insert(item));
    return "added";
  }
  // Back in stock: an item marked out (0) is replaced by what was just bought.
  if (match.quantity === 0) {
    mustOk(
      await db
        .from("kitchen_items")
        .update({ quantity: item.quantity, unit: item.unit })
        .eq("id", match.id),
    );
    return "merged";
  }
  if (match.quantity === null || item.quantity === null) return "had";
  // Same measured family: add in base units, then express in the existing row's unit.
  const kind = unitKind(item.unit);
  if (match.unit && item.unit && (kind === "volume" || kind === "mass")) {
    const total = fromBase(
      toBase(match.quantity, match.unit) + toBase(item.quantity, item.unit),
      match.unit,
    );
    mustOk(
      await db
        .from("kitchen_items")
        .update({ quantity: Math.round(total * 100) / 100 })
        .eq("id", match.id),
    );
  } else {
    mustOk(
      await db
        .from("kitchen_items")
        .update({ quantity: Math.round((match.quantity + item.quantity) * 100) / 100 })
        .eq("id", match.id),
    );
  }
  return "merged";
}

/** The quick-add box: one item per line, e.g. `2 onions`, `1 lb chicken thighs`, `rice`. */
export async function quickAddKitchen(input: z.input<typeof quickAddSchema>) {
  return runAction(async () => {
    const { text, location } = quickAddSchema.parse(input);
    const items = parseQuickAddLines(text);
    if (items.length === 0)
      throw new ActionFailure("validation", "Type something you have, like “6 eggs”.");
    const db = await userClient();
    const outcomes = { added: 0, merged: 0, had: 0 };
    for (const item of items.slice(0, 50)) {
      outcomes[await addOrMerge(db, { ...item, location })]++;
    }
    refresh();
    return { names: items.map((i) => i.name), ...outcomes };
  });
}

/** Adds something that was just bought (from the grocery list), with the amount the person confirmed. */
export async function addPurchasedToKitchen(input: z.input<typeof kitchenItemSchema>) {
  return runAction(async () => {
    const data = kitchenItemSchema.parse(input);
    const db = await userClient();
    const outcome = await addOrMerge(db, {
      name: sentenceCase(cleanDisplayName(data.name)) || data.name,
      normalized_name: normalizeIngredientName(data.name) || data.name.toLowerCase(),
      quantity: data.quantity,
      unit: data.unit,
      location: data.location,
    });
    refresh();
    return { outcome };
  });
}

export async function updateKitchenItem(input: z.input<typeof updateKitchenItemSchema>) {
  return runAction(async () => {
    const { id, ...data } = updateKitchenItemSchema.parse(input);
    const db = await userClient();
    const updated = must(
      await db
        .from("kitchen_items")
        .update({
          name: data.name,
          normalized_name: normalizeIngredientName(data.name) || data.name.toLowerCase(),
          quantity: data.quantity,
          unit: data.unit,
          location: data.location,
          expires_at: data.expires_at,
          note: data.note,
        })
        .eq("id", id)
        .select("id"),
    );
    if (updated.length !== 1) throw new ActionFailure("not_found", "We couldn't find that item.");
    refresh();
  });
}

/** "Mark out" sets the amount to 0 (kept so it is easy to bring back); undo = "have some". */
export async function setKitchenOut(input: { id: string; out: boolean }) {
  return runAction(async () => {
    const { id, out } = z.object({ id: uuid, out: z.boolean() }).parse(input);
    const db = await userClient();
    mustOk(
      await db
        .from("kitchen_items")
        .update({ quantity: out ? 0 : null })
        .eq("id", id),
    );
    refresh();
  });
}

export async function deleteKitchenItem(id: string) {
  return runAction(async () => {
    const db = await userClient();
    mustOk(await db.from("kitchen_items").delete().eq("id", uuid.parse(id)));
    refresh();
  });
}

const deductionsSchema = z.object({
  items: z
    .array(z.object({ id: uuid, quantity: z.number().min(0).max(100_000) }))
    .min(1)
    .max(100),
});

/**
 * "Update kitchen" after cooking: applies the new amounts the person confirmed. Nothing here runs
 * on its own — Pinched only suggests; the person chooses which rows to update.
 */
export async function applyKitchenDeductions(input: z.input<typeof deductionsSchema>) {
  return runAction(async () => {
    const { items } = deductionsSchema.parse(input);
    const db = await userClient();
    for (const item of items) {
      mustOk(await db.from("kitchen_items").update({ quantity: item.quantity }).eq("id", item.id));
    }
    refresh();
    return { updated: items.length };
  });
}
