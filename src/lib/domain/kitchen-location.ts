import type { GrocerySection, KitchenLocation } from "./constants";
import { classifySection } from "./ingredient-data";
import { normalizeIngredientName } from "./ingredients";

/** Produce that lives on the counter or in the pantry, not the fridge. */
const PANTRY_PRODUCE =
  /\b(onions?|shallots?|garlic|potato(?:es)?|yams?|squash|pumpkin|bananas?|tomato(?:es)?|avocados?|ginger|plantains?|mango(?:es)?|pineapples?|melons?|watermelon)\b/;

/**
 * Where something most likely lives. Only ever a starting point: it pre-fills the "Add to Kitchen"
 * prompt and a quick add typed on the "All" tab, and the person can change it (location is optional).
 */
export function kitchenLocationFor(section: GrocerySection, name = ""): KitchenLocation {
  if (section === "Frozen") return "freezer";
  if (section === "Dairy & Eggs" || section === "Meat & Seafood") return "fridge";
  if (section === "Produce") return PANTRY_PRODUCE.test(name.toLowerCase()) ? "pantry" : "fridge";
  return "pantry";
}

/** The same guess from just a name, for items typed into the kitchen ("lemons", "Milk"). */
export function guessKitchenLocation(name: string): KitchenLocation {
  const normalized = normalizeIngredientName(name) || name.toLowerCase();
  return kitchenLocationFor(classifySection(normalized), normalized);
}
