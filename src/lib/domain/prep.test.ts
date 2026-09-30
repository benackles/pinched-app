import { describe, expect, it } from "vitest";

import {
  generatePrep,
  mealPrepStatus,
  mergePrepRegeneration,
  summarizePrep,
  usedInLabel,
  type ExistingPrepTask,
  type PrepDraftTask,
} from "./prep";
import { meal, recipe } from "./test-helpers";

const MON = "2026-09-28";
const TUE = "2026-09-29";
const WED = "2026-09-30";
const THU = "2026-10-01";
const FRI = "2026-10-02";

/** The PRD's example week: turkey patties, chicken bowls, curry, fried rice, pasta. */
function prdWeek() {
  return [
    meal(
      "m-patties",
      MON,
      4,
      recipe(
        "Turkey Patties",
        4,
        [
          "1 lb ground turkey",
          "1 yellow onion, diced",
          "1 cup Greek yogurt",
          "1 cucumber",
          "1 lemon, juiced",
          "1 bunch dill",
        ],
        [
          "Mix the turkey and onion, then form patties.",
          "Stir yogurt, cucumber, lemon juice and dill together into a sauce.",
          "Cook the patties in a skillet, 5 minutes per side.",
        ],
      ),
    ),
    meal(
      "m-bowls",
      TUE,
      4,
      recipe(
        "Chicken Bowls",
        4,
        ["1.5 lb chicken thighs", "2 cups jasmine rice", "2 sweet potatoes"],
        [
          "Cook the rice.",
          "Toss the sweet potatoes with olive oil and salt. Roast at 425°F for 25 minutes.",
          "Sear the chicken and serve over rice.",
        ],
      ),
    ),
    meal(
      "m-curry",
      WED,
      4,
      recipe(
        "Chicken Curry",
        4,
        ["1 lb chicken thighs", "1 yellow onion, diced", "1 can coconut milk"],
        ["Sauté the onion, add chicken and coconut milk, and simmer."],
      ),
    ),
    meal(
      "m-fried",
      THU,
      4,
      recipe(
        "Fried Rice",
        4,
        ["2 cups rice", "2 eggs", "2 sweet potatoes"],
        ["Roast the sweet potatoes until tender.", "Stir-fry the rice with the eggs."],
      ),
    ),
    meal(
      "m-pasta",
      FRI,
      4,
      recipe(
        "Pasta",
        4,
        ["1 lb spaghetti", "1 yellow onion, sliced", "1 can crushed tomatoes"],
        ["Boil the pasta.", "Simmer the onion in the tomatoes and toss."],
      ),
    ),
  ];
}

const byKey = (tasks: PrepDraftTask[], key: string) => tasks.find((t) => t.generation_key === key);

describe("the PRD example week", () => {
  const tasks = generatePrep(prdWeek());

  it("consolidates onions across three meals and keeps the cuts visible", () => {
    expect(byKey(tasks, "cut:onion")).toMatchObject({
      title: "Prep 3 onions",
      minutes: 12, // 3 min setup + 3 onions × 3 min
      is_passive: false,
      description: "Dice 2 → Turkey Patties, Chicken Curry · Slice 1 → Pasta",
    });
    expect(byKey(tasks, "cut:onion")!.meals.map((m) => m.meal_id)).toEqual([
      "m-patties",
      "m-curry",
      "m-pasta",
    ]);
  });

  it("cooks rice once for both meals that use it", () => {
    expect(byKey(tasks, "grain:rice")).toMatchObject({
      title: "Cook 4 cups rice",
      minutes: 25,
      is_passive: true, // "mostly hands-off"
    });
    expect(usedInLabel(byKey(tasks, "grain:rice")!.meals)).toBe(
      "Chicken Bowls (Tue), Fried Rice (Thu)",
    );
  });

  it("roasts the sweet potatoes once for Tuesday and Thursday", () => {
    expect(byKey(tasks, "roast:sweet potato")).toMatchObject({
      title: "Roast sweet potatoes",
      minutes: 30,
      is_passive: true,
      description: "425°F, about 25 min per the recipe",
    });
    expect(byKey(tasks, "roast:sweet potato")!.meals.map((m) => m.meal_id)).toEqual([
      "m-bowls",
      "m-fried",
    ]);
  });

  it("mixes the yogurt sauce for the patties", () => {
    const sauce = tasks.find((t) => t.kind === "sauce")!;
    expect(sauce).toMatchObject({ title: "Mix yogurt sauce", minutes: 5, is_passive: false });
    expect(sauce.meals.map((m) => m.title)).toEqual(["Turkey Patties"]);
  });

  it("generates nothing else: no chicken, no lemon juicing, no pasta boiling", () => {
    expect(tasks.map((t) => t.title).sort()).toEqual([
      "Cook 4 cups rice",
      "Mix yogurt sauce",
      "Prep 3 onions",
      "Roast sweet potatoes",
    ]);
  });

  it("orders hands-off work first so active work fills the wait", () => {
    expect(tasks.map((t) => t.title)).toEqual([
      "Cook 4 cups rice",
      "Roast sweet potatoes",
      "Prep 3 onions",
      "Mix yogurt sauce",
    ]);
    expect(tasks.map((t) => t.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("totals the session and estimates what consolidation saves", () => {
    const summary = summarizePrep(tasks);
    expect(summary).toMatchObject({
      taskCount: 4,
      totalMinutes: 72,
      passiveMinutes: 55,
      activeMinutes: 17,
    });
    // onions: 3 separate tasks (18) vs 12 → 6; rice: 2×25 vs 25 → 25; roast: 2×30 vs 30 → 30
    expect(summary.savedMinutes).toBe(61);
  });
});

describe("cut tasks", () => {
  it("scales quantities by meal servings", () => {
    const r = recipe("Soup", 4, ["2 yellow onions, diced"]);
    expect(generatePrep([meal("m1", MON, 8, r)])[0]).toMatchObject({
      title: "Dice 4 onions",
      minutes: 15,
    });
  });

  it("names the single cut when there is only one", () => {
    const r = recipe("Salad", 4, ["3 cloves garlic, minced"]);
    const r2 = recipe("Pasta", 4, ["3 cloves garlic, minced"]);
    const [task] = generatePrep([meal("m1", MON, 4, r), meal("m2", TUE, 4, r2)]);
    expect(task).toMatchObject({ title: "Mince 6 cloves garlic", minutes: 5 });
  });

  it("treats 'peeled and cubed' as one cut", () => {
    const [task] = generatePrep([
      meal("m1", MON, 4, recipe("Hash", 4, ["2 potatoes, peeled and cubed"])),
    ]);
    expect(task!.title).toBe("Cube 2 potatoes");
  });

  it("does not make a task for a cut it cannot do ahead", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe("Tacos", 4, [
          "2 avocados, sliced",
          "1 bunch cilantro, chopped, for garnish",
          "1 banana, sliced",
        ]),
      ),
    ]);
    expect(tasks).toEqual([]);
  });

  it("finds cuts named only in the recipe steps, clause by clause", () => {
    const r = recipe(
      "Salad",
      4,
      ["1 cucumber", "4 radishes", "1 bunch dill"],
      ["Dice the cucumber and slice the radishes.", "Serve with chopped dill."],
    );
    const tasks = generatePrep([meal("m1", MON, 4, r)]);
    expect(tasks.map((t) => t.title).sort()).toEqual(["Dice 1 cucumber", "Slice 4 radishes"]);
  });

  it("does not grate meat or chop pantry goods", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe("Stew", 4, ["1 lb beef, cubed", "1 can black beans, drained and rinsed"]),
      ),
    ]);
    expect(tasks).toEqual([]);
  });

  it("shreds cheese ahead", () => {
    const [task] = generatePrep([
      meal("m1", MON, 4, recipe("Tacos", 4, ["2 cups cheddar, shredded"])),
    ]);
    expect(task).toMatchObject({ title: "Shred 2 cups cheddar" });
  });

  it("never invents an amount when the recipe gives none", () => {
    const [task] = generatePrep([meal("m1", MON, 4, recipe("Stir fry", 4, ["onion, sliced"]))]);
    expect(task!.title).toBe("Slice onion");
  });

  it("drops the quantity from the title when units differ", () => {
    const tasks = generatePrep([
      meal("m1", MON, 4, recipe("A", 4, ["2 onions, diced"])),
      meal("m2", TUE, 4, recipe("B", 4, ["1 cup onion, diced"])),
    ]);
    expect(tasks[0]!.title).toBe("Dice onion");
  });
});

describe("roasting", () => {
  it("does not pre-roast vegetables that share a pan with the meat (one-pan dinners)", () => {
    const sheetPan = recipe(
      "Sheet-Pan Chicken",
      4,
      ["2 lb chicken thighs", "2 sweet potatoes, cubed", "1 head broccoli"],
      [
        "Heat oven to 425°F.",
        "Toss chicken, sweet potatoes and broccoli with oil on a sheet pan.",
        "Roast 35 minutes until the chicken is crisp.",
      ],
    );
    const tasks = generatePrep([meal("m1", MON, 4, sheetPan)]);
    expect(tasks.some((t) => t.kind === "roast")).toBe(false);
  });

  it("puts a vegetable's cutting right before its roast", () => {
    const r = recipe(
      "Bowls",
      4,
      ["1 cup rice", "2 sweet potatoes, cubed", "1 onion, diced"],
      ["Toss the sweet potatoes with oil. Roast at 425°F for 25 minutes."],
    );
    const order = generatePrep([meal("m1", MON, 4, r)]).map((t) => t.generation_key);
    expect(order).toEqual(["grain:rice", "cut:sweet potato", "roast:sweet potato", "cut:onion"]);
  });

  it("uses quicker times for quick vegetables", () => {
    const r = recipe(
      "Sides",
      4,
      ["1 head broccoli"],
      ["Toss the broccoli with oil and roast until crisp."],
    );
    expect(generatePrep([meal("m1", MON, 4, r)])[0]).toMatchObject({
      title: "Roast broccoli",
      minutes: 20,
    });
  });
});

describe("grains", () => {
  it("batches different rices separately", () => {
    const tasks = generatePrep([
      meal("m1", MON, 4, recipe("A", 4, ["1 cup basmati rice", "1 cup quinoa"])),
    ]);
    expect(tasks.map((t) => t.title).sort()).toEqual([
      "Cook 1 cup basmati rice",
      "Cook 1 cup quinoa",
    ]);
  });

  it("takes longer for a big batch", () => {
    const r = recipe("Party", 4, ["6 cups rice"]);
    expect(generatePrep([meal("m1", MON, 4, r)])[0]).toMatchObject({
      title: "Cook 6 cups rice",
      minutes: 35,
    });
  });

  it("ignores rice vinegar and cauliflower rice", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe("Bowl", 4, ["2 tbsp rice vinegar", "1 bag frozen cauliflower rice"]),
      ),
    ]);
    expect(tasks).toEqual([]);
  });
});

describe("sauces, marinades and mixes", () => {
  it("makes cold sauces and dressings ahead, but not hot ones", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        2,
        recipe(
          "Salmon Bowls",
          2,
          ["2 tbsp soy sauce", "1 tbsp rice vinegar"],
          ["Whisk soy sauce and rice vinegar into a dressing."],
        ),
      ),
      meal(
        "m2",
        TUE,
        4,
        recipe(
          "Pasta",
          4,
          ["1 can tomatoes", "4 cloves garlic"],
          ["Simmer the tomatoes and garlic into a sauce."],
        ),
      ),
    ]);
    expect(tasks.map((t) => t.title)).toEqual(["Mix soy sauce dressing"]);
  });

  it("makes a glaze", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        2,
        recipe(
          "Miso Cod",
          2,
          ["3 tbsp white miso", "1 tbsp honey"],
          ["Whisk miso, honey and soy sauce into a glaze."],
        ),
      ),
    ]);
    expect(tasks[0]).toMatchObject({ title: "Make miso glaze", minutes: 5 });
  });

  it("marinates ahead", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe(
          "Kebabs",
          4,
          ["1 lb chicken thighs", "2 tbsp olive oil"],
          ["Marinate the chicken in the oil and spices for at least 1 hour."],
        ),
      ),
    ]);
    expect(tasks[0]).toMatchObject({
      title: "Marinate chicken thighs",
      minutes: 5,
      kind: "marinate",
    });
  });

  it("mixes dry ingredients for batter recipes", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe(
          "Waffles",
          4,
          ["2 cups flour", "1 tbsp baking powder"],
          [
            "Whisk flour and baking powder in a bowl.",
            "Whisk eggs and milk; fold into the dry ingredients.",
          ],
        ),
      ),
    ]);
    expect(tasks[0]).toMatchObject({ title: "Mix dry ingredients for Waffles", kind: "mix" });
  });

  it("does not treat a wet mix as a dry mix", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe(
          "Cake",
          4,
          ["2 cups flour", "1 cup sugar"],
          ["Whisk the flour, sugar and eggs together."],
        ),
      ),
    ]);
    expect(tasks).toEqual([]);
  });

  it("skips 'just before serving' steps", () => {
    const tasks = generatePrep([
      meal(
        "m1",
        MON,
        4,
        recipe(
          "Bowl",
          4,
          ["1 cup yogurt", "1 lemon"],
          ["Stir the yogurt and lemon together into a sauce just before serving."],
        ),
      ),
    ]);
    expect(tasks).toEqual([]);
  });

  it("merges the same recipe planned twice into one bigger batch", () => {
    const r = recipe(
      "Salmon Bowls",
      2,
      ["2 tbsp soy sauce"],
      ["Whisk soy sauce and vinegar into a dressing."],
    );
    const [task] = generatePrep([meal("m1", MON, 2, r), meal("m2", WED, 2, r)]);
    expect(task).toMatchObject({ minutes: 7, per_recipe_minutes: 10 });
    expect(task!.meals).toHaveLength(2);
  });
});

describe("failure never blocks", () => {
  it("returns an empty plan for no meals and for meals with nothing to prep", () => {
    expect(generatePrep([])).toEqual([]);
    expect(
      generatePrep([
        meal(
          "m1",
          MON,
          4,
          recipe(
            "Toast",
            4,
            ["2 slices bread", "1 tbsp butter"],
            ["Toast the bread and butter it."],
          ),
        ),
      ]),
    ).toEqual([]);
  });

  it("copes with recipes that have no steps and odd ingredient rows", () => {
    const r = recipe("Mystery", null, ["", "salt"], []);
    expect(() => generatePrep([meal("m1", MON, 4, r)])).not.toThrow();
  });
});

describe("mealPrepStatus", () => {
  const tasks = [
    { is_completed: true, meal_ids: ["a", "b"] },
    { is_completed: false, meal_ids: ["a"] },
    { is_completed: true, meal_ids: ["b"] },
  ];
  it("labels the meal card chip with words", () => {
    expect(mealPrepStatus("a", tasks)).toEqual({
      state: "partial",
      done: 1,
      total: 2,
      label: "1/2 prepped",
    });
    expect(mealPrepStatus("b", tasks)).toEqual({
      state: "done",
      done: 2,
      total: 2,
      label: "Prepped",
    });
    expect(mealPrepStatus("c", tasks)).toEqual({
      state: "none",
      done: 0,
      total: 0,
      label: "No prep",
    });
  });
});

// ─────────────────────────────── regeneration ───────────────────────────────

const existing = (over: Partial<ExistingPrepTask> & { id: string }): ExistingPrepTask => ({
  generation_key: null,
  title: "x",
  description: null,
  minutes: 10,
  is_passive: false,
  sort_order: 0,
  is_completed: false,
  completed_at: null,
  is_custom: false,
  is_edited: false,
  ...over,
});

const draft = (key: string, over: Partial<PrepDraftTask> = {}): PrepDraftTask => ({
  generation_key: key,
  kind: "cut",
  title: key,
  description: null,
  minutes: 10,
  is_passive: false,
  meals: [],
  per_recipe_minutes: 10,
  sort_order: 0,
  ...over,
});

describe("regeneration keeps manual changes (PRD)", () => {
  it("keeps completion, and refreshes untouched tasks", () => {
    const result = mergePrepRegeneration(
      [
        existing({
          id: "t1",
          generation_key: "cut:onion",
          title: "Prep 2 onions",
          minutes: 9,
          is_completed: true,
          completed_at: "2026-09-27T10:00:00Z",
        }),
      ],
      [draft("cut:onion", { title: "Prep 3 onions", minutes: 12 })],
      { manuallyOrdered: false },
    );
    expect(result.tasks[0]).toMatchObject({
      id: "t1",
      title: "Prep 3 onions",
      minutes: 12,
      is_completed: true,
      completed_at: "2026-09-27T10:00:00Z",
    });
  });

  it("keeps an edited task's wording and minutes", () => {
    const result = mergePrepRegeneration(
      [
        existing({
          id: "t1",
          generation_key: "cut:onion",
          title: "Dice onions for the week",
          minutes: 20,
          description: "my note",
          is_edited: true,
        }),
      ],
      [draft("cut:onion", { title: "Prep 3 onions", minutes: 12, description: "generated" })],
      { manuallyOrdered: false },
    );
    expect(result.tasks[0]).toMatchObject({
      title: "Dice onions for the week",
      minutes: 20,
      description: "my note",
      is_edited: true,
    });
  });

  it("always keeps custom tasks", () => {
    const result = mergePrepRegeneration(
      [existing({ id: "c1", is_custom: true, title: "Wash greens", sort_order: 0 })],
      [draft("cut:onion")],
      { manuallyOrdered: false },
    );
    expect(result.deleteIds).toEqual([]);
    expect(result.tasks.map((t) => t.title)).toEqual(["cut:onion", "Wash greens"]);
  });

  it("deletes generated tasks whose meals left, unless the person edited them", () => {
    const gone = mergePrepRegeneration([existing({ id: "t1", generation_key: "cut:onion" })], [], {
      manuallyOrdered: false,
    });
    expect(gone.deleteIds).toEqual(["t1"]);

    const edited = mergePrepRegeneration(
      [existing({ id: "t2", generation_key: "cut:onion", is_edited: true, title: "My onions" })],
      [],
      { manuallyOrdered: false },
    );
    expect(edited.deleteIds).toEqual([]);
    expect(edited.clearMealsFor).toEqual(["t2"]);
    expect(edited.tasks[0]).toMatchObject({
      id: "t2",
      is_custom: true,
      generation_key: null,
      title: "My onions",
    });
  });

  it("follows the algorithm's order until the person reorders, then keeps their order", () => {
    const current = [
      existing({ id: "a", generation_key: "grain:rice", sort_order: 1 }),
      existing({ id: "b", generation_key: "cut:onion", sort_order: 0 }),
    ];
    const drafts = [draft("grain:rice"), draft("cut:onion"), draft("roast:sweet potato")];

    const auto = mergePrepRegeneration(current, drafts, { manuallyOrdered: false });
    expect(auto.tasks.map((t) => t.generation_key)).toEqual([
      "grain:rice",
      "cut:onion",
      "roast:sweet potato",
    ]);

    const manual = mergePrepRegeneration(current, drafts, { manuallyOrdered: true });
    expect(manual.tasks.map((t) => t.generation_key)).toEqual([
      "cut:onion",
      "grain:rice",
      "roast:sweet potato",
    ]);
    expect(manual.tasks.map((t) => t.sort_order)).toEqual([0, 1, 2]);
  });

  it("inserts new tasks and drops duplicate rows for a key", () => {
    const result = mergePrepRegeneration(
      [
        existing({ id: "a", generation_key: "cut:onion" }),
        existing({ id: "b", generation_key: "cut:onion" }),
      ],
      [draft("cut:onion"), draft("grain:rice")],
      { manuallyOrdered: false },
    );
    expect(result.deleteIds).toEqual(["b"]);
    expect(result.tasks.find((t) => t.generation_key === "grain:rice")).toMatchObject({
      id: null,
      is_completed: false,
    });
  });
});
