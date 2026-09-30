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
