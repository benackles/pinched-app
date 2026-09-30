import type { GrocerySection } from "@/lib/domain/constants";
import { formatQuantity, unitLabel } from "@/lib/domain/units";

export type GroceryItemView = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  display_text: string | null;
  section: GrocerySection;
  is_checked: boolean;
  is_already_owned: boolean;
  is_custom: boolean;
  /** Titles of the planned meals this item is for. */
  sources: string[];
};

/** "2 cups", "a little" (the recipe's own words), or "" when there is no amount. */
export function groceryAmount(
  item: Pick<GroceryItemView, "quantity" | "unit" | "display_text">,
): string {
  if (item.display_text) return item.display_text;
  if (item.quantity === null) return "";
  const amount = formatQuantity(item.quantity);
  return item.unit ? `${amount} ${unitLabel(item.unit, item.quantity)}` : amount;
}

/** Where a bought item most likely lives, for the "Add to Kitchen" prefill. */
export function kitchenLocationFor(section: GrocerySection): "pantry" | "fridge" | "freezer" {
  if (section === "Frozen") return "freezer";
  if (section === "Produce" || section === "Dairy & Eggs" || section === "Meat & Seafood")
    return "fridge";
  return "pantry";
}
