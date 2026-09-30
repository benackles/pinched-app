import { describe, expect, it } from "vitest";

import {
  generateGrocery,
  mergeGroceryRegeneration,
  type ExistingGroceryItem,
  type GroceryDraftItem,
  type KitchenStock,
} from "./grocery";
import { meal, recipe } from "./test-helpers";

const MON = "2026-09-28";
const TUE = "2026-09-29";
const WED = "2026-09-30";

const find = (items: GroceryDraftItem[], key: string) =>
  items.find((i) => i.normalized_name === key);

describe("merging duplicates", () => {
  it("PRD: 2 onions + 1 onion + ½ onion → 3.5 onions", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["2 yellow onions"])),
      meal("m2", TUE, 4, recipe("B", 4, ["1 onion"])),
      meal("m3", WED, 4, recipe("C", 4, ["1/2 onion"])),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      normalized_name: "onion",
      quantity: 3.5,
      unit: null,
      name: "onions",
      section: "Produce",
    });
    expect(items[0]!.sources.map((s) => s.planned_meal_id)).toEqual(["m1", "m2", "m3"]);
  });

  it("uses singular for one and plural for many", () => {
    const one = generateGrocery([meal("m1", MON, 4, recipe("A", 4, ["1 large egg"]))]);
    expect(one[0]).toMatchObject({ quantity: 1, name: "egg" });
    const many = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 large egg"])),
      meal("m2", TUE, 4, recipe("B", 4, ["3 eggs"])),
    ]);
    expect(many[0]).toMatchObject({ quantity: 4, name: "eggs" });
  });

  it("merges synonyms (scallions = green onions)", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["4 scallions, sliced"])),
      meal("m2", TUE, 4, recipe("B", 4, ["2 green onions"])),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ normalized_name: "scallion", quantity: 6 });
  });

  it("combines compatible measured units and picks a kitchen-friendly one", () => {
    const tbsp = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["2 tbsp olive oil"])),
      meal("m2", TUE, 4, recipe("B", 4, ["1/4 cup olive oil"])),
    ]);
    expect(tbsp).toHaveLength(1);
    expect(tbsp[0]).toMatchObject({ quantity: 6, unit: "tbsp" });

    const cups = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 cup milk"])),
      meal("m2", TUE, 4, recipe("B", 4, ["1/2 cup milk"])),
    ]);
    expect(cups[0]).toMatchObject({ quantity: 1.5, unit: "cup" });

    const mass = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 lb chicken thighs"])),
      meal("m2", TUE, 4, recipe("B", 4, ["8 oz chicken thighs"])),
    ]);
    expect(mass[0]).toMatchObject({ quantity: 1.5, unit: "lb" });
  });

  it("PRD: incompatible units stay separate rows (2 cups spinach, 1 bag spinach)", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["2 cups spinach"])),
      meal("m2", TUE, 4, recipe("B", 4, ["1 bag spinach"])),
      meal("m3", WED, 4, recipe("C", 4, ["1 lb spinach"])),
    ]);
    const spinach = items.filter((i) => i.normalized_name === "spinach");
    expect(spinach).toHaveLength(3);
    expect(spinach.map((i) => [i.quantity, i.unit]).sort()).toEqual(
      [
        [1, "bag"],
        [1, "lb"],
        [2, "cup"],
      ].sort(),
    );
  });

  it("never converts between volume and weight (no density guessing)", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 cup flour"])),
      meal("m2", TUE, 4, recipe("B", 4, ["200 g flour"])),
    ]);
    expect(items).toHaveLength(2);
  });

  it("merges named units only with themselves", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["3 cloves garlic"])),
      meal("m2", TUE, 4, recipe("B", 4, ["2 cloves garlic, minced"])),
      meal("m3", WED, 4, recipe("C", 4, ["1 head garlic"])),
    ]);
    expect(items.map((i) => [i.quantity, i.unit]).sort()).toEqual(
      [
        [1, "head"],
        [5, "clove"],
      ].sort(),
    );
  });

  it("keeps different can sizes apart", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 (14-oz) can diced tomatoes"])),
      meal("m2", TUE, 4, recipe("B", 4, ["2 (14-oz) cans diced tomatoes"])),
      meal("m3", WED, 4, recipe("C", 4, ["1 (28-oz) can diced tomatoes"])),
    ]);
    expect(items.map((i) => [i.quantity, i.unit]).sort()).toEqual(
      [
        [1, "28-oz can"],
        [3, "14-oz can"],
      ].sort(),
    );
  });

  it("buys the upper end of a range (over-adding beats running short)", () => {
    const items = generateGrocery([meal("m1", MON, 4, recipe("A", 4, ["2-3 cloves garlic"]))]);
    expect(items[0]).toMatchObject({ quantity: 3, unit: "clove" });
  });

  it("does not merge products that are not the same thing", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 red onion"])),
      meal("m2", TUE, 4, recipe("B", 4, ["1 yellow onion"])),
      meal(
        "m3",
        WED,
        4,
        recipe("C", 4, ["1 lb boneless skinless chicken thighs", "1 lb bone-in chicken thighs"]),
      ),
    ]);
    expect(items.map((i) => i.normalized_name).sort()).toEqual([
      "bone-in chicken thigh",
      "boneless skinless chicken thigh",
      "onion",
      "red onion",
    ]);
  });
});

describe("scaling to servings", () => {
  const chicken = recipe("Bowls", 4, ["1.5 lb chicken thighs", "2 cups rice", "3 cloves garlic"]);

  it("scales every quantity by meal servings ÷ recipe servings", () => {
    const half = generateGrocery([meal("m1", MON, 2, chicken)]);
    expect(find(half, "chicken thigh")).toMatchObject({ quantity: 0.75, unit: "lb" });
    expect(find(half, "rice")).toMatchObject({ quantity: 1, unit: "cup" });
    expect(find(half, "garlic")).toMatchObject({ quantity: 1.5, unit: "clove" });

    const big = generateGrocery([meal("m1", MON, 6, chicken)]);
    expect(find(big, "chicken thigh")).toMatchObject({ quantity: 2.25, unit: "lb" });
    expect(find(big, "rice")).toMatchObject({ quantity: 3, unit: "cup" });
  });

  it("sums the same recipe planned twice at different servings", () => {
    const items = generateGrocery([meal("m1", MON, 4, chicken), meal("m2", WED, 2, chicken)]);
    expect(find(items, "rice")).toMatchObject({ quantity: 3, unit: "cup" });
    expect(find(items, "rice")!.sources).toHaveLength(2);
  });

  it("uses quantities exactly as written when the recipe's yield is unknown", () => {
    const mystery = recipe("Mystery stew", null, ["2 cups broth", "1 lb beef"]);
    const items = generateGrocery([meal("m1", MON, 9, mystery)]);
    expect(find(items, "beef")).toMatchObject({ quantity: 1, unit: "lb" });
    expect(find(items, "broth")).toMatchObject({ quantity: 2, unit: "cup" });
  });
});

describe("amounts that cannot be added up", () => {
  it("lists vague ingredients once, keeping the recipe's wording", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["some fresh basil"])),
      meal("m2", TUE, 4, recipe("B", 4, ["a little fresh basil"])),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      normalized_name: "basil",
      quantity: null,
      display_text: "some fresh basil",
    });
    expect(items[0]!.sources).toHaveLength(2);
  });

  it("folds 'to taste' into the measured row for the same food", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["1 tsp kosher salt"])),
      meal("m2", TUE, 4, recipe("B", 4, ["kosher salt, to taste"])),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 1, unit: "tsp" });
    expect(items[0]!.sources).toHaveLength(2); // the "to taste" mention is still linked
  });

  it("keeps a lone 'to taste' ingredient as a plain row", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["Salt and pepper, to taste"])),
    ]);
    expect(items.map((i) => [i.normalized_name, i.quantity])).toEqual([
      ["black pepper", null],
      ["salt", null],
    ]);
  });

  it("lists water but pre-marks it as on hand, never dropping it silently", () => {
    const items = generateGrocery([
      meal("m1", MON, 4, recipe("A", 4, ["2 cups water", "1 cup rice"])),
    ]);
    expect(find(items, "water")).toMatchObject({ is_already_owned: true, owned_reason: "assumed" });
    expect(find(items, "rice")).toMatchObject({ is_already_owned: false });
  });
});

describe("aisles and ordering", () => {
  it("assigns each item its aisle and orders by aisle then name", () => {
    const items = generateGrocery([
      meal(
        "m1",
        MON,
        4,
        recipe("A", 4, [
          "1 lb ground turkey",
          "1 cup yogurt",
          "1 onion",
          "1 lb spaghetti",
          "4 buns",
          "1 cup frozen peas",
        ]),
      ),
    ]);
    expect(items.map((i) => [i.section, i.normalized_name])).toEqual([
      ["Produce", "onion"],
      ["Meat & Seafood", "ground turkey"],
      ["Dairy & Eggs", "yogurt"],
      ["Bakery", "bun"],
      ["Pantry", "spaghetti"],
      ["Frozen", "frozen pea"],
    ]);
  });
});

describe("inventory: the list is the gap", () => {
  const plan = () => [
    meal("m1", MON, 4, recipe("A", 4, ["2 onions", "1 lb chicken thighs", "2 cups rice"])),
    meal("m2", TUE, 4, recipe("B", 4, ["1 onion", "1/2 onion", "1 cup rice"])),
  ];
  const stock = (over: Partial<KitchenStock> & { name: string }): KitchenStock => ({
    normalized_name: over.name.toLowerCase(),
    quantity: null,
    unit: null,
    ...over,
  });

  it("subtracts what you have and lists only what is missing", () => {
    const items = generateGrocery(plan(), [stock({ name: "onion", quantity: 2 })]);
    expect(find(items, "onion")).toMatchObject({ quantity: 1.5, is_already_owned: false });
  });

  it("marks an item owned when the kitchen covers it entirely", () => {
    const items = generateGrocery(plan(), [stock({ name: "onion", quantity: 4 })]);
    expect(find(items, "onion")).toMatchObject({
      is_already_owned: true,
      owned_reason: "kitchen",
      quantity: 3.5,
    });
  });

  it("treats an item with no quantity as 'have some' → already have", () => {
    const items = generateGrocery(plan(), [stock({ name: "rice" })]);
    expect(find(items, "rice")).toMatchObject({ is_already_owned: true, owned_reason: "kitchen" });
    expect(find(items, "onion")).toMatchObject({ is_already_owned: false });
  });

  it("ignores items marked out (quantity 0)", () => {
    const items = generateGrocery(plan(), [stock({ name: "rice", quantity: 0 })]);
    expect(find(items, "rice")).toMatchObject({
      is_already_owned: false,
      quantity: 3,
      unit: "cup",
    });
  });

  it("converts within a unit family (500 g covers a pound)", () => {
    const items = generateGrocery(plan(), [
      stock({ name: "chicken thighs", quantity: 500, unit: "g" }),
    ]);
    expect(find(items, "chicken thigh")).toMatchObject({ is_already_owned: true });
    const partial = generateGrocery(plan(), [
      stock({ name: "chicken thighs", quantity: 8, unit: "oz" }),
    ]);
    expect(find(partial, "chicken thigh")).toMatchObject({
      is_already_owned: false,
      quantity: 0.5,
      unit: "lb",
    });
  });

  it("sums stock across locations (pantry + fridge)", () => {
    const items = generateGrocery(plan(), [
      stock({ name: "rice", quantity: 1, unit: "cup" }),
      stock({ name: "rice", quantity: 1, unit: "cup" }),
    ]);
    expect(find(items, "rice")).toMatchObject({
      quantity: 1,
      unit: "cup",
      is_already_owned: false,
    });
  });

  it("PRD principle 5: an uncertain match stays on the list", () => {
    // incompatible units: cups of rice on the list, pounds in the kitchen
    expect(
      find(generateGrocery(plan(), [stock({ name: "rice", quantity: 2, unit: "lb" })]), "rice"),
    ).toMatchObject({ is_already_owned: false, quantity: 3 });
    // a different product: "chicken thighs" at home, "boneless skinless chicken thighs" needed
    const specific = generateGrocery(
      [meal("m1", MON, 4, recipe("A", 4, ["1 lb boneless skinless chicken thighs"]))],
      [stock({ name: "chicken thighs", quantity: 3, unit: "lb" })],
    );
    expect(specific[0]).toMatchObject({ is_already_owned: false });
    // a bag of spinach does not cover cups of spinach
    const spinach = generateGrocery(
      [meal("m1", MON, 4, recipe("A", 4, ["2 cups spinach"]))],
      [stock({ name: "spinach", quantity: 1, unit: "bag" })],
    );
    expect(spinach[0]).toMatchObject({ is_already_owned: false, quantity: 2 });
  });

  it("covers a vague need ('salt to taste') with any stock", () => {
    const items = generateGrocery(
      [meal("m1", MON, 4, recipe("A", 4, ["kosher salt, to taste"]))],
      [stock({ name: "kosher salt", quantity: 1, unit: "lb" })],
    );
    expect(items[0]).toMatchObject({ is_already_owned: true, owned_reason: "kitchen" });
  });

  it("keeps links to every source meal even when stock covers the item", () => {
    const items = generateGrocery(plan(), [stock({ name: "onion", quantity: 10 })]);
    expect(find(items, "onion")!.sources).toHaveLength(3);
  });

  it("works with an empty kitchen (week one)", () => {
    const items = generateGrocery(plan(), []);
    expect(items.every((i) => !i.is_already_owned)).toBe(true);
    expect(find(items, "onion")).toMatchObject({ quantity: 3.5 });
  });
});

// ─────────────────────────────── regeneration ───────────────────────────────

function existing(
  over: Partial<ExistingGroceryItem> & { id: string; generation_key: string | null },
): ExistingGroceryItem {
  return {
    name: "x",
    normalized_name: "x",
    quantity: 1,
    unit: null,
    display_text: null,
    section: "Produce",
    is_custom: false,
    is_checked: false,
    is_already_owned: false,
    owned_reason: null,
    is_removed: false,
    is_edited: false,
    ...over,
  };
}

const draft = (over: Partial<GroceryDraftItem> & { generation_key: string }): GroceryDraftItem => ({
  name: "x",
  normalized_name: over.generation_key.split("|")[0]!,
  quantity: 1,
  unit: null,
  display_text: null,
  section: "Produce",
  is_already_owned: false,
  owned_reason: null,
  sources: [],
  ...over,
});

describe("regeneration keeps manual changes (PRD)", () => {
  it("keeps custom items untouched", () => {
    const result = mergeGroceryRegeneration(
      [existing({ id: "c1", generation_key: null, is_custom: true, name: "limes" })],
      [draft({ generation_key: "onion|each", name: "onions", quantity: 2 })],
    );
    expect(result.deleteIds).toEqual([]);
    expect(result.items.map((i) => i.id)).toEqual([null]); // only the new generated item; the custom row is not touched
  });

  it("updates quantities on existing generated items and keeps them checked", () => {
    const result = mergeGroceryRegeneration(
      [existing({ id: "g1", generation_key: "onion|each", quantity: 2, is_checked: true })],
      [draft({ generation_key: "onion|each", name: "onions", quantity: 4 })],
    );
    expect(result.items[0]).toMatchObject({ id: "g1", quantity: 4, is_checked: true });
  });

  it("keeps a removed item removed", () => {
    const result = mergeGroceryRegeneration(
      [existing({ id: "g1", generation_key: "onion|each", is_removed: true })],
      [draft({ generation_key: "onion|each", quantity: 4 })],
    );
    expect(result.items[0]).toMatchObject({ id: "g1", is_removed: true });
  });

  it("keeps the person's own 'already have', and never flips a checked item to already-have", () => {
    const owned = mergeGroceryRegeneration(
      [
        existing({
          id: "g1",
          generation_key: "rice|vol",
          is_already_owned: true,
          owned_reason: "user",
        }),
      ],
      [draft({ generation_key: "rice|vol", is_already_owned: false })],
    );
    expect(owned.items[0]).toMatchObject({ is_already_owned: true, owned_reason: "user" });

    // Buying it added it to the kitchen, so the fresh draft says "in your kitchen" — the checked item stays put.
    const bought = mergeGroceryRegeneration(
      [existing({ id: "g2", generation_key: "rice|vol", is_checked: true })],
      [draft({ generation_key: "rice|vol", is_already_owned: true, owned_reason: "kitchen" })],
    );
    expect(bought.items[0]).toMatchObject({ is_checked: true, is_already_owned: false });
  });

  it("releases a kitchen-derived 'already have' when the kitchen no longer covers it", () => {
    const result = mergeGroceryRegeneration(
      [
        existing({
          id: "g1",
          generation_key: "rice|vol",
          is_already_owned: true,
          owned_reason: "kitchen",
        }),
      ],
      [draft({ generation_key: "rice|vol", is_already_owned: false })],
    );
    expect(result.items[0]).toMatchObject({ is_already_owned: false });
  });

  it("keeps an edited item's name, quantity, unit and aisle", () => {
    const result = mergeGroceryRegeneration(
      [
        existing({
          id: "g1",
          generation_key: "onion|each",
          name: "sweet onions",
          quantity: 6,
          unit: null,
          section: "Other",
          is_edited: true,
        }),
      ],
      [draft({ generation_key: "onion|each", name: "onions", quantity: 2, section: "Produce" })],
    );
    expect(result.items[0]).toMatchObject({
      id: "g1",
      name: "sweet onions",
      quantity: 6,
      section: "Other",
      is_edited: true,
    });
  });

  it("deletes generated items whose meals are gone", () => {
    const result = mergeGroceryRegeneration(
      [existing({ id: "g1", generation_key: "onion|each" })],
      [],
    );
    expect(result.deleteIds).toEqual(["g1"]);
  });

  it("turns an edited item into a custom item when its meals are gone, instead of losing it", () => {
    const result = mergeGroceryRegeneration(
      [
        existing({
          id: "g1",
          generation_key: "onion|each",
          is_edited: true,
          name: "sweet onions",
          quantity: 6,
        }),
      ],
      [],
    );
    expect(result.deleteIds).toEqual([]);
    expect(result.clearSourcesFor).toEqual(["g1"]);
    expect(result.items[0]).toMatchObject({
      id: "g1",
      is_custom: true,
      generation_key: null,
      name: "sweet onions",
      quantity: 6,
    });
  });

  it("drops duplicate rows for one key", () => {
    const result = mergeGroceryRegeneration(
      [
        existing({ id: "a", generation_key: "onion|each" }),
        existing({ id: "b", generation_key: "onion|each" }),
      ],
      [draft({ generation_key: "onion|each" })],
    );
    expect(result.deleteIds).toEqual(["b"]);
  });

  it("inserts brand-new generated items", () => {
    const result = mergeGroceryRegeneration(
      [],
      [draft({ generation_key: "lime|each", name: "limes", quantity: 2 })],
    );
    expect(result.items[0]).toMatchObject({
      id: null,
      name: "limes",
      is_checked: false,
      is_custom: false,
    });
  });
});
