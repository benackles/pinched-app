import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildCatalog, parseCatalog } from "./build";
import type { CatalogRecipe } from "./schema";

const catalogDir = path.resolve(import.meta.dirname, "../../../data/catalog");

function readCatalog(): CatalogRecipe[] {
  return fs
    .readdirSync(catalogDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) =>
      parseCatalog(JSON.parse(fs.readFileSync(path.join(catalogDir, name), "utf8")), name),
    );
}

const base: CatalogRecipe = {
  slug: "test-toast",
  title: "Test Toast",
  headnote: "A plain slice of toast that is here to exercise the catalog builder.",
  servings: 2,
  prep_minutes: 2,
  cook_minutes: 3,
  tags: ["breakfast", "vegetarian"],
  ingredients: ["4 slices bread", "2 tbsp butter", "1 pinch salt"],
  steps: ["Toast the bread until golden.", "Butter it while it is hot."],
  reviewed: false,
};

describe("parseCatalog", () => {
  it("accepts a single recipe or a list, and defaults reviewed to false", () => {
    const { reviewed: _reviewed, ...unreviewed } = base;
    expect(parseCatalog(unreviewed)).toHaveLength(1);
    expect(parseCatalog([unreviewed, { ...unreviewed, slug: "other-toast" }])).toHaveLength(2);
    expect(parseCatalog(unreviewed)[0]?.reviewed).toBe(false);
  });

  it("names the recipe and field for every problem", () => {
    expect(() =>
      parseCatalog(
        [{ ...base, slug: "Bad Slug", tags: ["breakfast", "keto"], steps: [] }],
        "x.json",
      ),
    ).toThrow(/x\.json › Bad Slug: slug[\s\S]*tags\.1[\s\S]*steps/);
  });

  it("rejects unknown keys so typos don't silently drop data", () => {
    expect(() => parseCatalog({ ...base, sevings: 4 })).toThrow(/sevings|Unrecognized/i);
  });
});

describe("buildCatalog", () => {
  it("keeps recipes unpublished unless reviewed or publishAll", () => {
    expect(buildCatalog([base]).sql).toMatch(/, null, null\)/);
    expect(buildCatalog([{ ...base, reviewed: true }]).sql).toMatch(/, null, now\(\)\)/);
    expect(buildCatalog([base], { publishAll: true }).sql).toMatch(/, null, now\(\)\)/);
  });

  it("escapes single quotes everywhere", () => {
    const { sql } = buildCatalog([
      {
        ...base,
        title: "Nana's Toast",
        ingredients: ["4 slices bread", "2 tbsp butter", "1 pinch salt", "1 tbsp baker's sugar"],
        steps: ["Toast until it's golden.", "Don't forget the butter."],
      },
    ]);
    expect(sql).toContain("'Nana''s Toast'");
    expect(sql).toContain("Toast until it''s golden.");
    expect(sql).not.toMatch(/[^'](Nana's)/);
  });

  it("rejects duplicate slugs", () => {
    expect(() => buildCatalog([base, { ...base }])).toThrow(/Duplicate catalog slug/);
  });

  it("reports ingredients it cannot place in an aisle or give a quantity", () => {
    const { issues } = buildCatalog([
      { ...base, ingredients: ["4 slices bread", "2 tbsp butter", "1 zorblax", "some quux"] },
    ]);
    expect(issues.map((issue) => issue.message).join("\n")).toMatch(/zorblax.*no aisle/);
    expect(issues.map((issue) => issue.message).join("\n")).toMatch(/quux.*no quantity/);
  });

  it("does not flag water as an unplaced ingredient", () => {
    const { issues } = buildCatalog([
      { ...base, ingredients: ["4 slices bread", "2 tbsp butter", "¼ cup water"] },
    ]);
    expect(issues).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const other = { ...base, slug: "a-toast" };
    expect(buildCatalog([base, other]).sql).toBe(buildCatalog([other, base]).sql);
  });
});

describe("seeded catalog data", () => {
  const recipes = readCatalog();

  it("has a useful number of recipes with unique slugs and titles", () => {
    expect(recipes.length).toBeGreaterThanOrEqual(30);
    expect(new Set(recipes.map((r) => r.slug)).size).toBe(recipes.length);
    expect(new Set(recipes.map((r) => r.title.toLowerCase())).size).toBe(recipes.length);
  });

  it("parses cleanly: every ingredient has an aisle and a quantity", () => {
    expect(buildCatalog(recipes).issues).toEqual([]);
  });

  it("covers every meal type the browser filters on", () => {
    for (const meal of ["breakfast", "lunch", "dinner"] as const) {
      expect(recipes.filter((r) => r.tags.includes(meal)).length, meal).toBeGreaterThanOrEqual(5);
    }
    for (const recipe of recipes) {
      expect(
        recipe.tags.some((tag) => ["breakfast", "lunch", "dinner"].includes(tag)),
        recipe.slug,
      ).toBe(true);
    }
  });

  it('keeps "quick" honest: 30 minutes or less start to finish', () => {
    for (const recipe of recipes.filter((r) => r.tags.includes("quick"))) {
      expect(recipe.prep_minutes + recipe.cook_minutes, recipe.slug).toBeLessThanOrEqual(30);
    }
  });

  it("does not claim authorship or origin", () => {
    for (const recipe of recipes) {
      expect(recipe.headnote, recipe.slug).not.toMatch(
        /\b(grandma|grandmother|nana|my mother|my mom|famous|authentic|world'?s best|as seen)\b/i,
      );
    }
  });

  describe("diet tags match the ingredients", () => {
    const MEAT_OR_FISH =
      /\b(chicken|beef|pork|turkey|lamb|veal|bacon|sausage|ham|steak|salmon|tuna|shrimp|fish|anchov\w*|prosciutto|pancetta|chorizo|cod|tilapia|lard|gelatin|oyster sauce)\b/i;
    const DAIRY =
      /\b(milk|butter|buttermilk|cheese|cheddar|mozzarella|parmesan|feta|ricotta|paneer|yogurt|cream|ghee|whey|half-and-half)\b/i;
    const ANIMAL_OTHER = /\b(eggs?|honey|mayo|mayonnaise)\b/i;
    const PLANT_DAIRY =
      /\b(peanut|almond|cashew|sunflower|apple|cocoa|coconut|soy|oat|nut|seed) (butter|milk|cream|yogurt)\b|\bcream of tartar\b|\bbutternut\b/gi;
    const GLUTEN =
      /\b(flour|pasta|noodles?|spaghetti|penne|rotini|macaroni|fusilli|linguine|orzo|lasagna|gnocchi|bread|breadcrumbs?|panko|tortillas?|buns?|rolls?|pita|naan|couscous|farro|barley|bulgur|soy sauce|seitan|crackers?|croutons?|wheat|rye|beer|udon|ramen|oats?)\b/i;
    const GLUTEN_FREE_FORM =
      /\b(rice|corn|almond|coconut|chickpea|tapioca|gluten-free) (noodles?|flour|tortillas?|pasta|bread)\b|\bgluten-free\b|\btamari\b|\bcornmeal\b/gi;

    const text = (recipe: CatalogRecipe) => recipe.ingredients.join("\n").replace(PLANT_DAIRY, "");

    it("vegetarian and vegan recipes contain no meat or fish", () => {
      for (const recipe of recipes.filter(
        (r) => r.tags.includes("vegetarian") || r.tags.includes("vegan"),
      )) {
        expect(text(recipe), recipe.slug).not.toMatch(MEAT_OR_FISH);
      }
    });

    it("vegan recipes contain no dairy, eggs or honey", () => {
      for (const recipe of recipes.filter((r) => r.tags.includes("vegan"))) {
        expect(text(recipe), recipe.slug).not.toMatch(DAIRY);
        expect(text(recipe), recipe.slug).not.toMatch(ANIMAL_OTHER);
      }
    });

    it("dairy-free recipes contain no dairy", () => {
      for (const recipe of recipes.filter((r) => r.tags.includes("dairy-free"))) {
        expect(text(recipe), recipe.slug).not.toMatch(DAIRY);
      }
    });

    it("gluten-free recipes contain no wheat, barley, rye or oats", () => {
      for (const recipe of recipes.filter((r) => r.tags.includes("gluten-free"))) {
        expect(text(recipe).replace(GLUTEN_FREE_FORM, ""), recipe.slug).not.toMatch(GLUTEN);
      }
    });

    it("pescatarian recipes contain no land meat", () => {
      const LAND_MEAT =
        /\b(chicken|beef|pork|turkey|lamb|veal|bacon|sausage|ham|steak|prosciutto|pancetta|chorizo)\b/i;
      for (const recipe of recipes.filter((r) => r.tags.includes("pescatarian"))) {
        expect(text(recipe), recipe.slug).not.toMatch(LAND_MEAT);
      }
    });
  });
});
