import { fromBase, pickMeasured, toBase, unitKind } from "./units";

/**
 * Serving math. The rule (PRD): scale to each meal's servings; if scaling is uncertain, keep the
 * original; never invent quantities.
 *
 * "Uncertain" means we do not know how many servings the recipe makes. Then quantities are used
 * exactly as written (factor 1) and the UI does not offer a servings stepper for that recipe.
 */

export function isScalable(recipeServings: number | null | undefined): recipeServings is number {
  return (
    typeof recipeServings === "number" && Number.isFinite(recipeServings) && recipeServings > 0
  );
}

/** How much to multiply a recipe's quantities by to serve `mealServings`. */
export function scaleFactor(
  recipeServings: number | null | undefined,
  mealServings: number,
): number {
  if (!isScalable(recipeServings)) return 1;
  if (!Number.isFinite(mealServings) || mealServings <= 0) return 1;
  return mealServings / recipeServings;
}

export function scaleQuantity(quantity: number | null, factor: number): number | null {
  return quantity === null ? null : quantity * factor;
}

/**
 * An ingredient scaled for display ("serves 6" instead of 4). Measured amounts move to the unit
 * cooks would actually reach for (½ cup, not 8 tbsp); counts and named units keep their unit;
 * a line with no quantity ("salt to taste") is returned untouched — never invent an amount.
 */
export function scaleIngredient<
  T extends { quantity: number | null; quantity_max?: number | null; unit: string | null },
>(ingredient: T, factor: number): T {
  if (ingredient.quantity === null || factor === 1 || !Number.isFinite(factor)) return ingredient;
  const kind = unitKind(ingredient.unit);
  const quantity = ingredient.quantity * factor;
  const max =
    ingredient.quantity_max !== null && ingredient.quantity_max !== undefined
      ? ingredient.quantity_max * factor
      : null;
  if ((kind === "volume" || kind === "mass") && ingredient.unit) {
    const picked = pickMeasured(toBase(quantity, ingredient.unit), kind, [ingredient.unit]);
    const scaledMax =
      max === null
        ? null
        : Math.round(fromBase(toBase(max, ingredient.unit), picked.unit) * 100) / 100;
    return { ...ingredient, quantity: picked.quantity, quantity_max: scaledMax, unit: picked.unit };
  }
  return { ...ingredient, quantity, quantity_max: max };
}

/** First whole number in a yield string: "4 servings" → 4, "Makes 12 muffins" → 12, "4-6" → 4. */
export function parseYield(value: string | number | null | undefined): {
  servings: number | null;
  label: string | null;
} {
  if (value === null || value === undefined || value === "") return { servings: null, label: null };
  if (typeof value === "number")
    return { servings: value > 0 ? Math.round(value) : null, label: null };
  const text = value.trim();
  const match = /(\d+(?:\.\d+)?)/.exec(text);
  const servings = match ? Math.round(Number(match[1])) : null;
  const plain = /^\d+(?:\.\d+)?$/.test(text) || /^\d+\s*servings?$/i.test(text);
  return {
    servings: servings && servings > 0 ? servings : null,
    label: plain ? null : text,
  };
}
