/** Builders for domain tests: real ingredient lines in, plannable recipes and meals out. */
import type { MealType } from "./constants";
import { parseIngredientList } from "./ingredients";
import type { MealInput, PlannableRecipe, RecipeIngredientRow } from "./types";

let seq = 0;

export function ingredients(lines: string[]): RecipeIngredientRow[] {
  return parseIngredientList(lines).map((ingredient, index) => ({
    ...ingredient,
    id: `ing-${++seq}`,
    sort_order: index,
  }));
}

export function recipe(
  title: string,
  servings: number | null,
  lines: string[],
  steps: string[] = [],
): PlannableRecipe {
  return {
    id: `recipe-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title,
    servings,
    total_minutes: 30,
    ingredients: ingredients(lines),
    steps: steps.map((instruction, index) => ({ step_number: index + 1, instruction })),
  };
}

export function meal(
  id: string,
  planned_date: string,
  servings: number,
  r: PlannableRecipe,
  meal_type: MealType = "dinner",
): MealInput {
  return { id, planned_date, servings, meal_type, recipe: r };
}
