import type { GrocerySection } from "./constants";

/** One ingredient line inside a personal version (recipe_modifications.changes). */
export type ModifiedIngredient = {
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  raw_text: string;
  grocery_section: GrocerySection;
};

/**
 * A personal version: the user's edits layered over an untouched original. Any field that is
 * absent falls back to the original recipe.
 */
export type RecipeChanges = {
  title?: string;
  servings?: number | null;
  total_minutes?: number | null;
  ingredients?: ModifiedIngredient[];
  steps?: string[];
};

/** Payload logged for every manual prep edit — signal for a later AI grouping pass. */
export type PrepEditSnapshot = {
  title?: string;
  description?: string | null;
  minutes?: number;
  sort_order?: number;
  is_completed?: boolean;
};
