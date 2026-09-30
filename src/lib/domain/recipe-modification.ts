import { normalizeIngredientName } from "./ingredients";
import type { PlannableRecipe, RecipeChanges } from "./types";

/**
 * Lays a personal version over the original. Anything the version does not change falls back to
 * the original recipe, which is never modified. Plan, grocery list, prep plan and cook view all
 * read the result, so "less chili" in your version means less chili on your list.
 */
export function applyModification(
  recipe: PlannableRecipe,
  changes: RecipeChanges | null | undefined,
): PlannableRecipe {
  if (!changes) return recipe;
  return {
    ...recipe,
    title: changes.title?.trim() ? changes.title.trim() : recipe.title,
    servings: changes.servings !== undefined ? changes.servings : recipe.servings,
    total_minutes:
      changes.total_minutes !== undefined ? changes.total_minutes : recipe.total_minutes,
    ingredients: changes.ingredients
      ? changes.ingredients.map((ingredient, index) => ({
          ...ingredient,
          id: null,
          sort_order: index,
          normalized_name: normalizeIngredientName(ingredient.name),
        }))
      : recipe.ingredients,
    steps: changes.steps
      ? changes.steps.map((instruction, index) => ({ step_number: index + 1, instruction }))
      : recipe.steps,
  };
}
