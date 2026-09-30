/** Shared vocabulary. Imported by the DB schema (CHECK constraints), validators and the UI. */

export const GROCERY_SECTIONS = [
  "Produce",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Bakery",
  "Pantry",
  "Frozen",
  "Other",
] as const;
export type GrocerySection = (typeof GROCERY_SECTIONS)[number];

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const KITCHEN_LOCATIONS = ["pantry", "fridge", "freezer", "other"] as const;
export type KitchenLocation = (typeof KITCHEN_LOCATIONS)[number];

export const RECIPE_SOURCES = ["seeded", "url_import", "manual"] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

export const PLAN_STATUSES = ["active", "archived"] as const;
export const MEDIA_KINDS = ["photo", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const OWNED_REASONS = ["kitchen", "assumed", "user"] as const;
export type OwnedReason = (typeof OWNED_REASONS)[number];

/** ISO weekday numbers for the profile's preferred prep day (1 = Monday … 7 = Sunday). */
export const PREP_DAYS = [
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
  { value: 1, label: "Monday" },
] as const;

/** Free tier (PRD → Pricing). Enforced server-side and again by database triggers. */
export const FREE_LIMITS = {
  savedRecipes: 25,
  urlImportsPerMonth: 5,
  prepPlans: 2,
  mediaPerRecipe: 1,
} as const;

export const MAX_SERVINGS = 99;
