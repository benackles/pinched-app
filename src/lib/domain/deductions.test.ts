import { describe, expect, it } from "vitest";

import { suggestDeductions, type StockRow } from "./deductions";
import { recipe } from "./test-helpers";

const stock = (over: Partial<StockRow> & { name: string; normalized_name: string }): StockRow => ({
  id: over.id ?? `k-${over.normalized_name}`,
  quantity: null,
  unit: null,
  ...over,
});

describe("suggestDeductions", () => {
  const turkey = recipe("Turkey Patties", 4, [
    "1 lb ground turkey",
    "2 onions, diced",
    "1 cup plain Greek yogurt",
    "salt, to taste",
  ]);

  it("suggests what the meal used, where the kitchen has a known amount in a compatible unit", () => {
    const result = suggestDeductions(turkey, 4, [
      stock({ name: "Onion", normalized_name: "onion", quantity: 3 }),
      stock({ name: "Ground turkey", normalized_name: "ground turkey", quantity: 24, unit: "oz" }),
      stock({ name: "Greek yogurt", normalized_name: "greek yogurt", quantity: 2, unit: "cup" }),
    ]);
    expect(result).toEqual([
      { kitchen_item_id: "k-onion", name: "Onion", unit: null, have: 3, use: 2, remaining: 1 },
      {
        kitchen_item_id: "k-ground turkey",
        name: "Ground turkey",
        unit: "oz",
        have: 24,
        use: 16,
        remaining: 8,
      },
      {
        kitchen_item_id: "k-greek yogurt",
        name: "Greek yogurt",
        unit: "cup",
        have: 2,
        use: 1,
        remaining: 1,
      },
    ]);
  });

  it("scales to the meal's servings", () => {
    const [onion] = suggestDeductions(turkey, 8, [
      stock({ name: "Onion", normalized_name: "onion", quantity: 5 }),
    ]);
    expect(onion).toMatchObject({ use: 4, remaining: 1 });
  });

  it("never suggests more than is on hand", () => {
    const [onion] = suggestDeductions(turkey, 4, [
      stock({ name: "Onion", normalized_name: "onion", quantity: 1 }),
    ]);
    expect(onion).toMatchObject({ use: 1, remaining: 0 });
  });

  it("converts between units of the same family (tbsp used from cups on hand)", () => {
    const sauce = recipe("Dressing", 4, ["4 tbsp olive oil"]);
    const [oil] = suggestDeductions(sauce, 4, [
      stock({ name: "Olive oil", normalized_name: "olive oil", quantity: 1, unit: "cup" }),
    ]);
    expect(oil).toMatchObject({ use: 0.25, remaining: 0.75 });
  });

  it("stays quiet when it is not confident", () => {
    const result = suggestDeductions(turkey, 4, [
      stock({ name: "Onion", normalized_name: "onion", quantity: null }), // "have some": no amount to subtract from
      stock({ name: "Ground turkey", normalized_name: "ground turkey", quantity: 2, unit: "can" }), // incompatible unit
      stock({ name: "Salt", normalized_name: "salt", quantity: 10, unit: "oz" }), // "to taste" has no amount
      stock({ name: "Greek yogurt", normalized_name: "greek yogurt", quantity: 0, unit: "cup" }), // marked out
      stock({ name: "Rice", normalized_name: "rice", quantity: 5, unit: "cup" }), // not in the recipe
    ]);
    expect(result).toEqual([]);
  });

  it("shares one use across several rows of the same food", () => {
    const rows = suggestDeductions(turkey, 4, [
      stock({ id: "a", name: "Onion", normalized_name: "onion", quantity: 1 }),
      stock({ id: "b", name: "Onion", normalized_name: "onion", quantity: 3 }),
    ]);
    expect(rows.map((r) => [r.kitchen_item_id, r.use, r.remaining])).toEqual([
      ["a", 1, 0],
      ["b", 1, 2],
    ]);
  });
});
