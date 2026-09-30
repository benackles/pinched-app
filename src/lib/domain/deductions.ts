/**
 * "Update kitchen" after cooking (PRD → Cook): suggested deductions the person confirms. Pinched
 * never deducts inventory on its own, and it only suggests where it is confident — the same food
 * (by normalized name) in a compatible unit, with a known amount on hand. Anything else is left
 * alone, because guessing wrong would quietly corrupt the kitchen.
 */
import { scaleFactor } from "./scaling";
import type { PlannableRecipe } from "./types";
import { fromBase, toBase, unitKey, unitKind } from "./units";

export type StockRow = {
  id: string;
  name: string;
  normalized_name: string;
  /** null = "have some" (no number); 0 = marked out. */
  quantity: number | null;
  unit: string | null;
};

export type Deduction = {
  kitchen_item_id: string;
  name: string;
  unit: string | null;
  have: number;
  use: number;
  remaining: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function suggestDeductions(
  recipe: PlannableRecipe,
  mealServings: number,
  kitchen: StockRow[],
): Deduction[] {
  const factor = scaleFactor(recipe.servings, mealServings);

  // What the meal uses, per food and unit family, in base units. Lines without a number are skipped:
  // "salt to taste" says nothing about how much was used.
  const used = new Map<string, number>();
  for (const ingredient of recipe.ingredients) {
    if (ingredient.quantity === null) continue;
    const scaled = ingredient.quantity * factor;
    const kind = unitKind(ingredient.unit);
    const base = kind === "volume" || kind === "mass" ? toBase(scaled, ingredient.unit) : scaled;
    const key = `${ingredient.normalized_name}|${unitKey(ingredient.unit)}`;
    used.set(key, (used.get(key) ?? 0) + base);
  }

  const suggestions: Deduction[] = [];
  for (const item of kitchen) {
    if (item.quantity === null || item.quantity <= 0) continue;
    const key = `${item.normalized_name}|${unitKey(item.unit)}`;
    const wanted = used.get(key);
    if (wanted === undefined || wanted <= 0) continue;

    const kind = unitKind(item.unit);
    const measured = (kind === "volume" || kind === "mass") && item.unit;
    const haveBase = measured ? toBase(item.quantity, item.unit) : item.quantity;
    const takenBase = Math.min(wanted, haveBase);
    // Several kitchen rows for the same food share what the meal used, oldest first.
    used.set(key, wanted - takenBase);

    const remainingBase = haveBase - takenBase;
    const remaining = round2(
      measured && item.unit ? fromBase(remainingBase, item.unit) : remainingBase,
    );
    suggestions.push({
      kitchen_item_id: item.id,
      name: item.name,
      unit: item.unit,
      have: item.quantity,
      use: round2(item.quantity - remaining),
      remaining: remaining < 0.05 ? 0 : remaining,
    });
  }
  return suggestions.filter((s) => s.use > 0);
}
