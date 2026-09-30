import { describe, expect, it } from "vitest";

import {
  cleanDisplayName,
  formatIngredient,
  normalizeIngredientName,
  parseIngredientLine,
  parseIngredientList,
  pluralizeName,
  type ParsedIngredient,
} from "./ingredients";

function parse(line: string): ParsedIngredient[] {
  return parseIngredientLine(line).flatMap((p) => (p.kind === "ingredient" ? [p.ingredient] : []));
}
function one(line: string): ParsedIngredient {
  const result = parse(line);
  expect(result, `"${line}" should parse to one ingredient`).toHaveLength(1);
  return result[0]!;
}

describe("normalizeIngredientName", () => {
  it.each([
    // PRD: yellow onions → onion
    ["yellow onions", "onion"],
    ["Yellow Onion", "onion"],
    ["onions", "onion"],
    // PRD: scallion / green onion, EVOO / olive oil
    ["scallions", "scallion"],
    ["green onions", "scallion"],
    ["spring onion", "scallion"],
    ["EVOO", "olive oil"],
    ["extra-virgin olive oil", "olive oil"],
    ["extra virgin olive oil", "olive oil"],
    // singularization
    ["tomatoes", "tomato"],
    ["sweet potatoes", "sweet potato"],
    ["chicken thighs", "chicken thigh"],
    ["brussels sprouts", "brussels sprout"],
    ["radishes", "radish"],
    ["berries", "berry"],
    ["bay leaves", "bay leaf"],
    ["eggs", "egg"],
    // words that end in s but are singular
    ["hummus", "hummus"],
    ["couscous", "couscous"],
    ["asparagus", "asparagus"],
    ["molasses", "molasses"],
    // filler words vanish
    ["fresh basil", "basil"],
    ["large eggs", "egg"],
    ["freshly ground black pepper", "black pepper"],
    ["garlic cloves", "garlic"],
    ["jalapeño", "jalapeno"],
    // things that must NOT merge (conservative)
    ["red onion", "red onion"],
    ["boneless skinless chicken thighs", "boneless skinless chicken thigh"],
    ["bone-in chicken thighs", "bone-in chicken thigh"],
    ["unsalted butter", "unsalted butter"],
    ["brown rice", "brown rice"],
    ["basmati rice", "basmati rice"],
    ["whole milk", "whole milk"],
    ["dried oregano", "dried oregano"],
    ["ground beef", "ground beef"],
    ["ground turkey", "ground turkey"],
    // curated merges
    ["jasmine rice", "rice"],
    ["all-purpose flour", "flour"],
    ["parmesan cheese", "parmesan"],
    ["chicken stock", "chicken broth"],
    ["panko breadcrumbs", "breadcrumb"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeIngredientName(input)).toBe(expected);
  });

  it("strips parentheticals and punctuation", () => {
    expect(normalizeIngredientName("Greek yogurt (2% or full fat)")).toBe("greek yogurt");
    expect(normalizeIngredientName("butter,")).toBe("butter");
  });
});

describe("cleanDisplayName / pluralizeName", () => {
  it("keeps the recipe's words minus filler", () => {
    expect(cleanDisplayName("Fresh Large Yellow Onion")).toBe("yellow onion");
    expect(cleanDisplayName("(optional) fresh dill")).toBe("dill");
  });

  it("pluralizes count nouns", () => {
    expect(pluralizeName("onion")).toBe("onions");
    expect(pluralizeName("chicken thigh")).toBe("chicken thighs");
    expect(pluralizeName("tomato")).toBe("tomatoes");
    expect(pluralizeName("berry")).toBe("berries");
    expect(pluralizeName("radish")).toBe("radishes");
    expect(pluralizeName("lime")).toBe("limes");
  });
});

describe("parseIngredientLine — quantities and units", () => {
  it("parses fractions, mixed numbers and unicode fractions", () => {
    expect(one("1 1/2 lb boneless skinless chicken thighs")).toMatchObject({
      quantity: 1.5,
      unit: "lb",
      name: "boneless skinless chicken thighs",
      normalized_name: "boneless skinless chicken thigh",
      grocery_section: "Meat & Seafood",
    });
    expect(one("1½ cups jasmine rice")).toMatchObject({
      quantity: 1.5,
      unit: "cup",
      normalized_name: "rice",
      grocery_section: "Pantry",
    });
    expect(one("¾ cup milk")).toMatchObject({
      quantity: 0.75,
      unit: "cup",
      grocery_section: "Dairy & Eggs",
    });
  });

  it("keeps ranges and uses the upper end downstream", () => {
    expect(one("2-3 cloves garlic, minced")).toMatchObject({
      quantity: 2,
      quantity_max: 3,
      unit: "clove",
      name: "garlic",
      preparation: "minced",
      grocery_section: "Produce",
    });
    expect(one("1 to 2 tablespoons honey")).toMatchObject({
      quantity: 1,
      quantity_max: 2,
      unit: "tbsp",
    });
  });

  it("treats sizes as descriptions, not units", () => {
    expect(one("1 large egg")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "egg",
      normalized_name: "egg",
      grocery_section: "Dairy & Eggs",
    });
    expect(one("2 medium sweet potatoes, peeled and cubed")).toMatchObject({
      quantity: 2,
      unit: null,
      normalized_name: "sweet potato",
      preparation: "peeled and cubed",
    });
  });

  it("captures countable units parse-ingredient does not know", () => {
    expect(one("4 slices bacon")).toMatchObject({
      quantity: 4,
      unit: "slice",
      name: "bacon",
      grocery_section: "Meat & Seafood",
    });
    expect(one("2 fillets salmon")).toMatchObject({ quantity: 2, unit: "fillet", name: "salmon" });
    expect(one("3 stalks celery")).toMatchObject({
      quantity: 3,
      unit: "stalk",
      name: "celery",
      grocery_section: "Produce",
    });
    expect(one("1 bunch fresh dill, chopped")).toMatchObject({
      unit: "bunch",
      name: "dill",
      preparation: "chopped",
    });
    expect(one("2 heads baby bok choy")).toMatchObject({ unit: "head", name: "baby bok choy" });
  });

  it("reads 'a handful of' as one handful without inventing a number", () => {
    expect(one("a handful of fresh basil leaves")).toMatchObject({
      quantity: 1,
      unit: "handful",
      normalized_name: "basil leaf",
    });
  });

  it("returns no quantity when the recipe gives none", () => {
    expect(one("rice")).toMatchObject({ quantity: null, unit: null, normalized_name: "rice" });
    expect(one("Kosher salt")).toMatchObject({ quantity: null, name: "kosher salt" });
  });
});

describe("parseIngredientLine — sized cans and jars", () => {
  it("keeps the size in the unit so different cans never merge", () => {
    expect(one("1 (14-oz) can diced tomatoes")).toMatchObject({
      quantity: 1,
      unit: "14-oz can",
      name: "diced tomatoes",
      grocery_section: "Pantry",
    });
    expect(one("1 28-oz can whole peeled tomatoes")).toMatchObject({
      quantity: 1,
      unit: "28-oz can",
      name: "whole peeled tomatoes",
      grocery_section: "Pantry",
    });
    expect(one("2 cans (15 oz each) black beans, drained and rinsed")).toMatchObject({
      quantity: 2,
      unit: "15-oz can",
      name: "black beans",
      preparation: "drained and rinsed",
      grocery_section: "Pantry",
    });
    expect(one("1 (16 ounce) package spaghetti")).toMatchObject({
      unit: "16-oz package",
      name: "spaghetti",
    });
  });

  it("treats a size on an item as a note, not a unit", () => {
    expect(one("3 (8-ounce) salmon fillets")).toMatchObject({
      quantity: 3,
      unit: null,
      name: "salmon fillets",
      grocery_section: "Meat & Seafood",
    });
  });

  it("files canned goods in the pantry even when the food is produce", () => {
    expect(one("1 can corn")).toMatchObject({ grocery_section: "Pantry" });
  });
});

describe("parseIngredientLine — preparation", () => {
  it("splits a trailing prep note at the comma", () => {
    expect(one("1 yellow onion, sliced")).toMatchObject({
      name: "yellow onion",
      normalized_name: "onion",
      preparation: "sliced",
    });
    expect(one("200 g cherry tomatoes, halved")).toMatchObject({
      quantity: 200,
      unit: "g",
      name: "cherry tomatoes",
      preparation: "halved",
    });
    expect(one("1 tablespoon butter, melted")).toMatchObject({ preparation: "melted" });
  });

  it("lifts a leading prep word off the name", () => {
    expect(one("1/2 cup grated Parmesan")).toMatchObject({
      name: "parmesan",
      normalized_name: "parmesan",
      preparation: "grated",
    });
    expect(one("2 tbsp finely chopped fresh parsley")).toMatchObject({
      name: "parsley",
      preparation: "finely chopped",
    });
    expect(one("4 scallions, thinly sliced")).toMatchObject({
      normalized_name: "scallion",
      preparation: "thinly sliced",
    });
  });

  it("drops parentheticals from the name", () => {
    expect(one("1 cup plain Greek yogurt (2% or full fat)")).toMatchObject({
      normalized_name: "greek yogurt",
      name: "plain greek yogurt",
    });
  });
});

describe("parseIngredientLine — special lines", () => {
  it("splits 'salt and pepper' into two ingredients", () => {
    const [salt, pepper] = parse("Salt and freshly ground black pepper, to taste");
    expect(salt).toMatchObject({
      normalized_name: "salt",
      quantity: null,
      preparation: "to taste",
    });
    expect(pepper).toMatchObject({
      normalized_name: "black pepper",
      quantity: null,
      preparation: "to taste",
    });
    expect(parse("Salt and pepper")).toHaveLength(2);
  });

  it("reads 'juice of 1 lemon' as a lemon that gets juiced", () => {
    expect(one("juice of 1 lemon")).toMatchObject({
      quantity: 1,
      normalized_name: "lemon",
      preparation: "juiced",
    });
    expect(one("Juice of 2 limes")).toMatchObject({
      quantity: 2,
      normalized_name: "lime",
      preparation: "juiced",
    });
    expect(one("zest of half a lemon")).toMatchObject({
      quantity: 0.5,
      normalized_name: "lemon",
      preparation: "zested",
    });
    expect(one("juice and zest of 1 orange")).toMatchObject({
      normalized_name: "orange",
      preparation: "juiced and zested",
    });
  });

  it("keeps the original line for display when there is no number", () => {
    expect(one("Salt, to taste").raw_text).toBe("Salt, to taste");
  });

  it("returns nothing for blank lines", () => {
    expect(parse("   ")).toEqual([]);
    expect(parse("")).toEqual([]);
  });
});

describe("parseIngredientList — group headers", () => {
  it("applies 'For the sauce:' to the lines below it", () => {
    const list = parseIngredientList([
      "1 lb ground turkey",
      "For the sauce:",
      "1 cup yogurt",
      "1 lemon, juiced",
      "For serving:",
      "4 buns",
    ]);
    expect(list.map((i) => [i.normalized_name, i.group_label])).toEqual([
      ["ground turkey", null],
      ["yogurt", "For the sauce"],
      ["lemon", "For the sauce"],
      ["bun", "For serving"],
    ]);
  });
});

describe("aisle classification on parsed lines", () => {
  it.each([
    ["2 cups baby spinach", "Produce"],
    ["1 lb ground turkey", "Meat & Seafood"],
    ["1 lb chicken thighs", "Meat & Seafood"],
    ["6 cups vegetable broth", "Pantry"],
    ["1 cup heavy cream", "Dairy & Eggs"],
    ["2 tbsp peanut butter", "Pantry"],
    ["1 eggplant", "Produce"],
    ["4 eggs", "Dairy & Eggs"],
    ["4 burger buns", "Bakery"],
    ["4 hot dog buns", "Bakery"],
    ["1 cup frozen peas", "Frozen"],
    ["1 tsp chili powder", "Pantry"],
    ["1 jalapeño, seeded", "Produce"],
    ["2 tbsp soy sauce", "Pantry"],
    ["1 cup cooked quinoa", "Pantry"],
    ["1 can coconut milk", "Pantry"],
    ["1 lb spaghetti", "Pantry"],
    ["8 oz cheddar, shredded", "Dairy & Eggs"],
    ["1 bunch cilantro", "Produce"],
    ["1/2 tsp cream of tartar", "Pantry"],
    ["1 roasted red pepper", "Pantry"], // jarred
    ["1 cup diced tomatoes", "Produce"],
    ["1 (14-oz) can crushed tomatoes", "Pantry"],
    ["aluminum foil", "Other"],
  ])("%s → %s", (line, section) => {
    expect(one(line).grocery_section).toBe(section);
  });
});

describe("formatIngredient", () => {
  it("formats amounts like a cookbook", () => {
    expect(formatIngredient(one("1½ cups jasmine rice"))).toBe("1½ cups jasmine rice");
    expect(formatIngredient(one("2-3 cloves garlic, minced"))).toBe("2–3 cloves garlic, minced");
    expect(formatIngredient(one("1 (14-oz) can diced tomatoes"))).toBe(
      "1 14-oz can diced tomatoes",
    );
    expect(formatIngredient(one("3 cloves garlic"))).toBe("3 cloves garlic");
  });

  it("falls back to the recipe's wording when there is no quantity", () => {
    expect(formatIngredient(one("Kosher salt, to taste"))).toBe("Kosher salt, to taste");
  });
});
