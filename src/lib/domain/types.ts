import type { GrocerySection, MealType } from "./constants";
import type { IngredientLike } from "./ingredients";

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

// ─────────────────────────────── what generation works with ───────────────────────────────
// Plain shapes, independent of the database, so grocery and prep generation are pure functions.

export type RecipeIngredientRow = IngredientLike & {
  /** The ingredients row id; null for lines that only exist in a personal version. */
  id: string | null;
  sort_order: number;
};

export type RecipeStepRow = { step_number: number; instruction: string };

/** A recipe as the planner sees it — with the user's personal version already applied. */
export type PlannableRecipe = {
  id: string;
  title: string;
  /** How many servings the recipe makes; null when unknown (quantities are then never scaled). */
  servings: number | null;
  total_minutes: number | null;
  ingredients: RecipeIngredientRow[];
  steps: RecipeStepRow[];
};

export type MealInput = {
  id: string;
  planned_date: string;
  meal_type: MealType;
  servings: number;
  sort_order?: number;
  recipe: PlannableRecipe;
};
