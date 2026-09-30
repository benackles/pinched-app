/**
 * Grocery list generation: what the plan needs, minus what the kitchen has — only the gap.
 *
 *  1. Collect ingredients from every planned meal (personal versions already applied).
 *  2. Scale to each meal's servings. Unknown recipe yield → use quantities as written.
 *  3. Normalize names with the curated synonym map (`yellow onions` → `onion`).
 *  4. Merge duplicates with compatible units (`2 onions + 1 onion + ½ onion` → `3½ onions`).
 *  5. Subtract kitchen inventory ONLY on a confident name and unit match.
 *  6. Assign an aisle and keep links back to every source meal.
 *  7. Regeneration (mergeGroceryRegeneration) re-applies manual edits: custom items, removed
 *     items, "already have" flags, checked-off items and edited quantities all survive.
 *
 * Ambiguity rules: an uncertain match stays on the list; an unparseable quantity keeps the
 * recipe's own words; incompatible units (`2 cups spinach`, `1 bag spinach`) stay separate rows.
 * Nothing is ever silently dropped — even "water" is listed, pre-marked as already on hand.
 */
import { GROCERY_SECTIONS, type GrocerySection, type OwnedReason } from "./constants";
import { ASSUMED_ON_HAND } from "./ingredient-data";
import { normalizeIngredientName, pluralizeName } from "./ingredients";
import { singularize } from "./ingredient-data";
import { scaleFactor } from "./scaling";
import type { MealInput } from "./types";
import { compatibleUnits, pickMeasured, toBase, unitKey, unitKind } from "./units";

export type GrocerySourceDraft = {
  planned_meal_id: string;
  ingredient_id: string | null;
  quantity: number | null;
  unit: string | null;
};

export type GroceryDraftItem = {
  /** Stable across regenerations: `${normalized_name}|${unit family}`. */
  generation_key: string;
  name: string;
  normalized_name: string;
  quantity: number | null;
  unit: string | null;
  /** The recipe's own wording, kept when the amount is vague ("a little olive oil"). */
  display_text: string | null;
  section: GrocerySection;
  is_already_owned: boolean;
  owned_reason: OwnedReason | null;
  sources: GrocerySourceDraft[];
};

export type KitchenStock = {
  name: string;
  normalized_name: string;
  /** null = "have some" (no number); 0 = marked out. */
  quantity: number | null;
  unit: string | null;
};

const EPSILON = 1e-6;
const round2 = (value: number) => Math.round(value * 100) / 100;

type Bucket = {
  key: string;
  nn: string;
  ukey: string;
  total: number;
  units: Set<string>;
  names: Map<string, { count: number; first: number }>;
  section: GrocerySection;
  sources: GrocerySourceDraft[];
  displayText: string | null;
  first: number;
};

const VAGUE_AMOUNT =
  /^(some|a little|a few|few|several|a bit|a touch|a drizzle|drizzle|a splash)\b/i;

function collect(meals: MealInput[]): Bucket[] {
  const buckets = new Map<string, Bucket>();
  let counter = 0;

  const ordered = [...meals].sort(
    (a, b) =>
      a.planned_date.localeCompare(b.planned_date) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.id.localeCompare(b.id),
  );

  for (const meal of ordered) {
    const factor = scaleFactor(meal.recipe.servings, meal.servings);
    for (const ingredient of meal.recipe.ingredients) {
      const nn = ingredient.normalized_name?.trim() || normalizeIngredientName(ingredient.name);
      if (!nn) continue;

      const upper = ingredient.quantity_max ?? ingredient.quantity;
      const scaled = upper === null ? null : upper * factor;
      const ukey = scaled === null ? "text" : unitKey(ingredient.unit);
      const key = `${nn}|${ukey}`;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          nn,
          ukey,
          total: 0,
          units: new Set(),
          names: new Map(),
          section: ingredient.grocery_section,
          sources: [],
          displayText: null,
          first: counter++,
        };
        buckets.set(key, bucket);
      }

      if (scaled !== null) {
        const kind = unitKind(ingredient.unit);
        bucket.total +=
          kind === "volume" || kind === "mass" ? toBase(scaled, ingredient.unit) : scaled;
        if (ingredient.unit) bucket.units.add(ingredient.unit);
      } else if (!bucket.displayText && VAGUE_AMOUNT.test(ingredient.raw_text.trim())) {
        bucket.displayText = ingredient.raw_text.trim();
      }

      const seen = bucket.names.get(ingredient.name);
      bucket.names.set(ingredient.name, {
        count: (seen?.count ?? 0) + 1,
        first: seen?.first ?? counter,
      });
      bucket.sources.push({
        planned_meal_id: meal.id,
        ingredient_id: ingredient.id,
        quantity: scaled,
        unit: ingredient.unit,
      });
    }
  }

  // "salt, to taste" has no number: fold it into a numeric row for the same food when there is one,
  // so the list says "1 tsp salt" once instead of "1 tsp salt" and "salt".
  const all = [...buckets.values()];
  for (const textOnly of all.filter((b) => b.ukey === "text")) {
    const host = all
      .filter((b) => b.nn === textOnly.nn && b.ukey !== "text")
      .sort((a, b) => a.first - b.first)[0];
    if (!host) continue;
    host.sources.push(...textOnly.sources);
    for (const [name, info] of textOnly.names) {
      const seen = host.names.get(name);
      host.names.set(name, {
        count: (seen?.count ?? 0) + info.count,
        first: seen?.first ?? info.first,
      });
    }
    buckets.delete(textOnly.key);
  }
  return [...buckets.values()];
}

/** The most common wording, singular or plural to match the quantity ("3 onions", "1 onion"). */
function displayName(bucket: Bucket, quantity: number | null): string {
  const ranked = [...bucket.names.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[1].first - b[1].first,
  );
  const top = ranked[0]?.[0] ?? bucket.nn;
  if (bucket.ukey !== "each") return top; // "2 cups rice", "3 cloves garlic": the unit carries the number
  const singular = singularize(top);
  if (quantity !== null && quantity > 1.03) {
    const plural = pluralizeName(singular);
    return ranked.find(([name]) => name === plural)?.[0] ?? plural;
  }
  return ranked.find(([name]) => name === singular)?.[0] ?? singular;
}

function toDraft(bucket: Bucket): GroceryDraftItem {
  let quantity: number | null = null;
  let unit: string | null = null;

  if (bucket.ukey === "vol" || bucket.ukey === "wt") {
    const picked = pickMeasured(bucket.total, bucket.ukey === "vol" ? "volume" : "mass", [
      ...bucket.units,
    ]);
    quantity = picked.quantity;
    unit = picked.unit;
  } else if (bucket.ukey === "each") {
    quantity = round2(bucket.total);
  } else if (bucket.ukey.startsWith("u:")) {
    quantity = round2(bucket.total);
    unit = bucket.ukey.slice(2);
  }

  const assumed = ASSUMED_ON_HAND.has(bucket.nn);
  return {
    generation_key: bucket.key,
    name: displayName(bucket, quantity),
    normalized_name: bucket.nn,
    quantity,
    unit,
    display_text: quantity === null ? bucket.displayText : null,
    section: bucket.section,
    is_already_owned: assumed,
    owned_reason: assumed ? "assumed" : null,
    sources: bucket.sources,
  };
}

function compareDrafts(a: GroceryDraftItem, b: GroceryDraftItem): number {
  return (
    GROCERY_SECTIONS.indexOf(a.section) - GROCERY_SECTIONS.indexOf(b.section) ||
    a.normalized_name.localeCompare(b.normalized_name) ||
    a.generation_key.localeCompare(b.generation_key)
  );
}

type StockRow = { nn: string; unit: string | null; quantity: number | null; remaining: number };

function buildStock(kitchen: KitchenStock[]): StockRow[] {
  return kitchen
    .filter((item) => item.quantity === null || item.quantity > 0)
    .map((item) => {
      const kind = unitKind(item.unit);
      const remaining =
        item.quantity === null
          ? 0
          : kind === "volume" || kind === "mass"
            ? toBase(item.quantity, item.unit)
            : item.quantity;
      return {
        nn: normalizeIngredientName(item.normalized_name || item.name),
        unit: item.unit,
        quantity: item.quantity,
        remaining,
      };
    });
}

/** Subtracts kitchen stock from the plan's needs. Mutates and returns the drafts it is given. */
function subtractInventory(items: GroceryDraftItem[], stock: StockRow[]): GroceryDraftItem[] {
  for (const item of items) {
    if (item.is_already_owned) continue;
    const matches = stock.filter((row) => row.nn === item.normalized_name);
    if (matches.length === 0) continue;

    // "have some": the person listed it without a number, which is a deliberate "I have this".
    if (matches.some((row) => row.quantity === null)) {
      item.is_already_owned = true;
      item.owned_reason = "kitchen";
      continue;
    }
    // A vague need ("salt to taste") and any stock at all.
    if (item.quantity === null) {
      item.is_already_owned = true;
      item.owned_reason = "kitchen";
      continue;
    }

    const kind = unitKind(item.unit);
    const measured = kind === "volume" || kind === "mass";
    const original = measured ? toBase(item.quantity, item.unit) : item.quantity;
    let need = original;
    for (const row of matches) {
      if (!compatibleUnits(row.unit, item.unit) || row.remaining <= 0) continue; // unsure → keep on list
      const take = Math.min(row.remaining, need);
      row.remaining -= take;
      need -= take;
      if (need <= EPSILON) break;
    }

    if (need <= original * 0.005 + EPSILON) {
      item.is_already_owned = true;
      item.owned_reason = "kitchen";
    } else if (need < original - EPSILON) {
      // Partly covered: list only what is missing.
      if (measured) {
        const seen = item.sources
          .map((s) => s.unit)
          .filter((u): u is string => !!u && unitKey(u) === unitKey(item.unit));
        const picked = pickMeasured(need, kind === "volume" ? "volume" : "mass", [
          ...new Set([item.unit!, ...seen]),
        ]);
        item.quantity = picked.quantity;
        item.unit = picked.unit;
      } else {
        item.quantity = round2(need);
      }
    }
  }
  return items;
}

/** Weekly recipe ingredients − kitchen inventory = grocery list (only the gap). */
export function generateGrocery(
  meals: MealInput[],
  kitchen: KitchenStock[] = [],
): GroceryDraftItem[] {
  const drafts = collect(meals).map(toDraft).sort(compareDrafts);
  return subtractInventory(drafts, buildStock(kitchen));
}

// ─────────────────────────────── regeneration merge ───────────────────────────────

export type ExistingGroceryItem = {
  id: string;
  generation_key: string | null;
  name: string;
  normalized_name: string;
  quantity: number | null;
  unit: string | null;
  display_text: string | null;
  section: GrocerySection;
  is_custom: boolean;
  is_checked: boolean;
  is_already_owned: boolean;
  owned_reason: OwnedReason | null;
  is_removed: boolean;
  is_edited: boolean;
};

export type MergedGroceryItem = {
  /** Existing row to update, or null to insert. */
  id: string | null;
  generation_key: string | null;
  name: string;
  normalized_name: string;
  quantity: number | null;
  unit: string | null;
  display_text: string | null;
  section: GrocerySection;
  is_custom: boolean;
  is_checked: boolean;
  is_already_owned: boolean;
  owned_reason: OwnedReason | null;
  is_removed: boolean;
  is_edited: boolean;
  /** Links to replace; null = leave the item's existing links alone. */
  sources: GrocerySourceDraft[] | null;
};

export type GroceryMergeResult = {
  items: MergedGroceryItem[];
  /** Existing rows that no longer belong on the list. */
  deleteIds: string[];
  /** Existing rows whose source links must be cleared (edited items kept after their meals left). */
  clearSourcesFor: string[];
};

/**
 * Merges a fresh generation into what the person already has, keeping their manual changes.
 *
 *  - custom items are untouched
 *  - a removed generated item stays removed
 *  - an edited generated item keeps the person's name, quantity, unit and aisle
 *  - a checked-off item stays checked (and is never flipped to "already have" because buying it
 *    just added it to the kitchen)
 *  - a person's own "already have" choice is kept
 *  - an edited item whose meals left the plan becomes a custom item instead of vanishing
 */
export function mergeGroceryRegeneration(
  existing: ExistingGroceryItem[],
  drafts: GroceryDraftItem[],
): GroceryMergeResult {
  const byKey = new Map<string, ExistingGroceryItem>();
  const deleteIds: string[] = [];
  for (const item of existing) {
    if (item.is_custom || !item.generation_key) continue;
    if (byKey.has(item.generation_key))
      deleteIds.push(item.id); // duplicate row: keep the first
    else byKey.set(item.generation_key, item);
  }

  const items: MergedGroceryItem[] = [];
  const used = new Set<string>();

  for (const draft of drafts) {
    const current = byKey.get(draft.generation_key);
    if (!current) {
      items.push({
        id: null,
        generation_key: draft.generation_key,
        name: draft.name,
        normalized_name: draft.normalized_name,
        quantity: draft.quantity,
        unit: draft.unit,
        display_text: draft.display_text,
        section: draft.section,
        is_custom: false,
        is_checked: false,
        is_already_owned: draft.is_already_owned,
        owned_reason: draft.owned_reason,
        is_removed: false,
        is_edited: false,
        sources: draft.sources,
      });
      continue;
    }

    used.add(current.id);
    const keepEdits = current.is_edited;
    let owned = draft.is_already_owned;
    let reason = draft.owned_reason;
    if (current.is_checked) {
      owned = current.is_already_owned;
      reason = current.owned_reason;
    } else if (current.is_already_owned && current.owned_reason === "user") {
      owned = true;
      reason = "user";
    }

    items.push({
      id: current.id,
      generation_key: draft.generation_key,
      name: keepEdits ? current.name : draft.name,
      normalized_name: draft.normalized_name,
      quantity: keepEdits ? current.quantity : draft.quantity,
      unit: keepEdits ? current.unit : draft.unit,
      display_text: keepEdits ? current.display_text : draft.display_text,
      section: keepEdits ? current.section : draft.section,
      is_custom: false,
      is_checked: current.is_checked,
      is_already_owned: owned,
      owned_reason: reason,
      is_removed: current.is_removed,
      is_edited: current.is_edited,
      sources: draft.sources,
    });
  }

  const clearSourcesFor: string[] = [];
  for (const item of existing) {
    if (item.is_custom) continue;
    if (!item.generation_key) continue;
    if (used.has(item.id) || deleteIds.includes(item.id)) continue;

    if (item.is_edited && !item.is_removed) {
      // The meals are gone but the person changed this item: keep it, as their own.
      items.push({
        ...item,
        generation_key: null,
        is_custom: true,
        is_edited: false,
        sources: null,
      });
      clearSourcesFor.push(item.id);
    } else {
      deleteIds.push(item.id);
    }
  }

  return { items, deleteIds, clearSourcesFor };
}
