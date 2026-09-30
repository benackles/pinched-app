/**
 * Prep plan generation — Pinched's differentiator: one consolidated session across the week's
 * recipes. Rules-based and explainable on purpose (PRD): every task says which meals it serves.
 *
 *  1. Extract prep actions from ingredient `preparation` fields and recipe-step verbs: chop, dice,
 *     slice, mince, peel, wash, roast, cook rice or grains, make sauce or dressing, marinate,
 *     portion, mix.
 *  2. Keep only actions that can be done ahead (skip "sear just before serving").
 *  3. Group the same ingredient and action across meals; keep distinct cuts visible.
 *  4. Estimate minutes from a lookup table, scaled by quantity.
 *  5. Order by longest passive time first (rice, roasting) so active work fills the wait.
 *  6. Everything lands in one prep session (Sunday by default).
 */
import { GRAINS } from "./ingredient-data";
import { pluralizeName } from "./ingredients";
import { scaleFactor } from "./scaling";
import type { MealInput, PlannableRecipe, RecipeIngredientRow } from "./types";
import { formatQuantity, pickMeasured, toBase, unitKind, unitLabel } from "./units";
import { shortDay } from "./week";

export type PrepMealRef = { meal_id: string; title: string; day: string };

export type PrepKind = "cut" | "grain" | "roast" | "sauce" | "marinate" | "mix" | "portion";

export type PrepDraftTask = {
  generation_key: string;
  kind: PrepKind;
  title: string;
  description: string | null;
  minutes: number;
  /** Mostly hands-off: rice, roasting. The cook can work on other tasks meanwhile. */
  is_passive: boolean;
  /** Meals this task serves, in day order. */
  meals: PrepMealRef[];
  /** What the same work would cost if every recipe did it on its own. */
  per_recipe_minutes: number;
  sort_order: number;
};

/** Setup and cleanup for one task (get the board out, wash up) — paid once per consolidated task. */
export const TASK_OVERHEAD_MINUTES = 3;

// ─────────────────────────────── lookup tables ───────────────────────────────

/** Minutes per whole item, by normalized name (PRD: dice one onion ≈ 3 min). */
const MINUTES_PER_ITEM: Record<string, number> = {
  onion: 3,
  "red onion": 3,
  "white onion": 3,
  shallot: 1.5,
  scallion: 0.5,
  garlic: 0.4, // per clove
  ginger: 1,
  carrot: 1.5,
  celery: 1,
  "bell pepper": 2,
  "red bell pepper": 2,
  "green bell pepper": 2,
  "yellow bell pepper": 2,
  jalapeno: 1,
  potato: 2.5,
  "sweet potato": 3,
  broccoli: 4,
  cauliflower: 5,
  cucumber: 2,
  tomato: 1.5,
  zucchini: 2,
  squash: 4,
  "butternut squash": 6,
  eggplant: 3,
  mushroom: 0.4,
  lemon: 1.5,
  lime: 1,
  orange: 2,
  cabbage: 5,
  kale: 3,
  fennel: 3,
  leek: 2,
  beet: 2.5,
  parsnip: 2,
  radish: 0.3,
};
const DEFAULT_MINUTES_PER_ITEM = 2;

/** Minutes per unit when the amount is measured or a named unit. */
const MINUTES_PER_UNIT: Record<string, number> = {
  cup: 1.5,
  lb: 4,
  oz: 0.3,
  g: 0.01,
  kg: 10,
  bunch: 3,
  head: 4,
  clove: 0.4,
  stalk: 1,
  sprig: 0.2,
  tbsp: 0.3,
  tsp: 0.2,
  slice: 0.3,
  piece: 1,
};

const ROAST_MINUTES: Record<string, number> = {
  broccoli: 20,
  cauliflower: 25,
  asparagus: 15,
  "green bean": 20,
  zucchini: 20,
  "bell pepper": 25,
  onion: 25,
  "red onion": 25,
  tomato: 25,
  mushroom: 20,
  "brussels sprout": 25,
};
const DEFAULT_ROAST_MINUTES = 30;

/** Vegetables that roast ahead and reheat well. Lemons, herbs and garlic are roasted in place, not ahead. */
const ROASTABLE = new Set([
  "sweet potato",
  "potato",
  "carrot",
  "parsnip",
  "beet",
  "squash",
  "butternut squash",
  "pumpkin",
  "broccoli",
  "cauliflower",
  "brussels sprout",
  "asparagus",
  "green bean",
  "zucchini",
  "bell pepper",
  "red bell pepper",
  "green bell pepper",
  "onion",
  "red onion",
  "fennel",
  "eggplant",
  "mushroom",
  "tomato",
]);

/** Cut produce that goes brown or soggy: prepped the day it is eaten, never ahead. */
const NOT_AHEAD = new Set(["avocado", "banana", "apple", "pear", "peach"]);

const PROTEIN_WORDS =
  /\b(chicken|turkey|beef|pork|lamb|sausage|bacon|salmon|cod|fish|shrimp|steak|ham|tofu|meatball|patty|patties)\b/i;
const LAST_MINUTE =
  /\b(just before (?:serving|eating)|right before|immediately before|at the last minute|serve (?:immediately|right away)|to serve|for serving|for garnish|garnish|for topping|top with|serve with)\b/i;
const HEAT = /\b(simmer|cook|heat|boil|saut[eé]|bake|fry|melt|sear|steam|brown|reduce|warm)\b/i;
const MIX_VERB = /\b(stir|whisk|mix|combine|blend|toss together)\b/i;

// ─────────────────────────────── extracting actions ───────────────────────────────

type CutVerb =
  | "Mince"
  | "Dice"
  | "Chop"
  | "Slice"
  | "Julienne"
  | "Grate"
  | "Shred"
  | "Cube"
  | "Halve"
  | "Quarter"
  | "Crush"
  | "Peel"
  | "Wash";

const CUT_PATTERNS: [RegExp, CutVerb][] = [
  [/\bminc(?:e|ed|ing)\b/i, "Mince"],
  [/\bdic(?:e|ed|ing)\b/i, "Dice"],
  [/\bchop(?:s|ped|ping)?\b/i, "Chop"],
  [/\bslic(?:e|ed|es|ing)\b/i, "Slice"],
  [/\bjulienn(?:e|ed)\b/i, "Julienne"],
  [/\bgrat(?:e|ed|ing)\b/i, "Grate"],
  [/\bshred(?:s|ded|ding)?\b/i, "Shred"],
  [/\bcub(?:e|ed|es|ing)\b/i, "Cube"],
  [/\bhalv(?:e|ed|es|ing)\b/i, "Halve"],
  [/\bquarter(?:s|ed|ing)?\b/i, "Quarter"],
  [/\bcrush(?:ed|ing)?\b/i, "Crush"],
  [/\bpeel(?:s|ed|ing)?\b/i, "Peel"],
  [/\b(?:wash(?:ed|ing)?|rins(?:e|ed|ing))\b/i, "Wash"],
];

/** A bare "cut" ("cut into 1-inch pieces") counts as chopping only when no specific cut is named. */
const GENERIC_CUT = /\bcut\b/i;

/** Verbs that are implied when a real cut is also named ("peeled and cubed" → Cube). */
const IMPLIED = new Set<CutVerb>(["Peel", "Wash"]);

type VerbHit = { verb: CutVerb; index: number };

function verbHits(text: string): VerbHit[] {
  return CUT_PATTERNS.map(([pattern, verb]) => ({ verb, index: text.search(pattern) }))
    .filter((hit) => hit.index >= 0)
    .sort((a, b) => a.index - b.index);
}

function verbsIn(text: string): CutVerb[] {
  const found = verbHits(text).map((hit) => hit.verb);
  const real = found.filter((verb) => !IMPLIED.has(verb));
  if (real.length > 0) return real;
  if (GENERIC_CUT.test(text)) return ["Chop"];
  return found.slice(0, 1);
}

/** Splits a step into clauses so each cut verb is matched with the ingredient right after it. */
const CLAUSE_SPLIT =
  /[.;,]|\bthen\b|\bwhile\b|\band\b(?=\s+(?:chop|dice|slice|mince|grate|shred|cube|halve|quarter|peel|wash|rinse|julienne|crush))/i;

function eligibleForCut(ingredient: RecipeIngredientRow, verb: CutVerb): boolean {
  if (NOT_AHEAD.has(ingredient.normalized_name)) return false;
  if (ingredient.grocery_section === "Produce") return true;
  // Hard cheese keeps well grated or shredded ahead of time.
  if (ingredient.grocery_section === "Dairy & Eggs") return verb === "Grate" || verb === "Shred";
  return false;
}

type CutAction = { ingredient: RecipeIngredientRow; verb: CutVerb };

/** Words that identify an ingredient inside recipe-step text (singular and plural of its last word). */
function nameTokens(ingredient: RecipeIngredientRow): string[] {
  const words = ingredient.normalized_name.split(" ");
  const last = words[words.length - 1] ?? "";
  const tokens = new Set([last, pluralizeName(last)]);
  if (words.length > 1) tokens.add(ingredient.normalized_name);
  return [...tokens].filter((t) => t.length > 2);
}

function mentions(text: string, ingredient: RecipeIngredientRow): boolean {
  const lower = text.toLowerCase();
  return nameTokens(ingredient).some((token) =>
    new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower),
  );
}

function extractCuts(recipe: PlannableRecipe): CutAction[] {
  const actions: CutAction[] = [];
  const covered = new Set<string>();

  // From the ingredient's own preparation note.
  for (const ingredient of recipe.ingredients) {
    const prep = ingredient.preparation ?? "";
    if (!prep || LAST_MINUTE.test(prep)) continue;
    for (const verb of verbsIn(prep)) {
      if (!eligibleForCut(ingredient, verb)) continue;
      actions.push({ ingredient, verb });
      covered.add(ingredient.normalized_name);
    }
  }

  // From step verbs, for ingredients whose own note named no cut: "Dice the onion, mince the garlic."
  for (const step of recipe.steps) {
    for (const clause of step.instruction.split(CLAUSE_SPLIT)) {
      if (!clause.trim() || LAST_MINUTE.test(clause)) continue;
      const first = verbHits(clause)[0];
      if (!first) continue;
      const verb = first.verb;
      const afterVerb = clause.slice(first.index);
      for (const ingredient of recipe.ingredients) {
        if (covered.has(ingredient.normalized_name)) continue;
        if (!eligibleForCut(ingredient, verb)) continue;
        if (!mentions(afterVerb, ingredient)) continue;
        actions.push({ ingredient, verb });
        covered.add(ingredient.normalized_name);
      }
    }
  }
  return actions;
}

// ─────────────────────────────── minutes ───────────────────────────────

function workMinutes(normalizedName: string, unit: string | null, quantity: number | null): number {
  const amount = quantity ?? 1;
  if (!unit) return (MINUTES_PER_ITEM[normalizedName] ?? DEFAULT_MINUTES_PER_ITEM) * amount;
  const perUnit = MINUTES_PER_UNIT[unit];
  if (perUnit !== undefined) {
    // "3 cloves" of garlic is cheaper than "3 cloves" of anything else, but per-unit already covers it.
    return perUnit * amount;
  }
  // Sized cans and other named units: treat each as one item.
  return (MINUTES_PER_ITEM[normalizedName] ?? DEFAULT_MINUTES_PER_ITEM) * amount;
}

const roundMinutes = (minutes: number) => Math.max(TASK_OVERHEAD_MINUTES, Math.round(minutes));

// ─────────────────────────────── generation ───────────────────────────────

type Usage = { meal: MealInput; recipe: PlannableRecipe; factor: number };

function ref(meal: MealInput, recipe: PlannableRecipe): PrepMealRef {
  return { meal_id: meal.id, title: recipe.title, day: meal.planned_date };
}

function uniqueMeals(refs: PrepMealRef[]): PrepMealRef[] {
  const seen = new Set<string>();
  return refs
    .filter((r) => (seen.has(r.meal_id) ? false : (seen.add(r.meal_id), true)))
    .sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}

function titleList(refs: PrepMealRef[]): string {
  const titles: string[] = [];
  for (const r of refs) if (!titles.includes(r.title)) titles.push(r.title);
  return titles.join(", ");
}

function qtyLabel(quantity: number | null, unit: string | null): string {
  if (quantity === null) return "";
  return [formatQuantity(quantity), unitLabel(unit, quantity)].filter(Boolean).join(" ");
}

type CutBucket = {
  nn: string;
  names: Map<string, number>;
  units: Set<string | null>;
  byVerb: Map<CutVerb, { quantity: number | null; unit: string | null; meals: PrepMealRef[] }>;
  meals: PrepMealRef[];
  work: number;
  perRecipe: number;
};

function buildCutTasks(usages: Usage[]): PrepDraftTask[] {
  const buckets = new Map<string, CutBucket>();

  for (const { meal, recipe, factor } of usages) {
    for (const { ingredient, verb } of extractCuts(recipe)) {
      const nn = ingredient.normalized_name;
      const upper = ingredient.quantity_max ?? ingredient.quantity;
      const quantity = upper === null ? null : upper * factor;
      const bucket: CutBucket = buckets.get(nn) ?? {
        nn,
        names: new Map(),
        units: new Set(),
        byVerb: new Map(),
        meals: [],
        work: 0,
        perRecipe: 0,
      };
      bucket.names.set(ingredient.name, (bucket.names.get(ingredient.name) ?? 0) + 1);
      bucket.units.add(ingredient.unit);
      const r = ref(meal, recipe);
      const group = bucket.byVerb.get(verb) ?? { quantity: 0, unit: ingredient.unit, meals: [] };
      group.quantity =
        group.quantity === null || quantity === null ? null : group.quantity + quantity;
      group.meals.push(r);
      bucket.byVerb.set(verb, group);
      bucket.meals.push(r);
      const minutes = workMinutes(nn, ingredient.unit, quantity);
      bucket.work += minutes;
      bucket.perRecipe += TASK_OVERHEAD_MINUTES + minutes;
      buckets.set(nn, bucket);
    }
  }

  const tasks: PrepDraftTask[] = [];
  for (const bucket of buckets.values()) {
    const meals = uniqueMeals(bucket.meals);
    const verbs = [...bucket.byVerb.keys()];
    const unitsConsistent = bucket.units.size === 1;
    const unit = unitsConsistent ? [...bucket.units][0]! : null;

    let total: number | null = 0;
    for (const group of bucket.byVerb.values())
      total = total === null || group.quantity === null ? null : total + group.quantity;
    if (!unitsConsistent) total = null;

    // The concise normalized name ("onion", not "large yellow onion"), plural for counted items.
    const name =
      unit === null && total !== null && total > 1.03 ? pluralizeName(bucket.nn) : bucket.nn;
    const amount = total === null ? "" : qtyLabel(total, unit);
    const verb = verbs.length === 1 ? verbs[0]! : "Prep";
    const title = [verb, amount, name].filter(Boolean).join(" ");

    const description = [...bucket.byVerb.entries()]
      .map(([v, group]) => {
        const qty =
          group.quantity === null || !unitsConsistent
            ? ""
            : ` ${qtyLabel(group.quantity, group.unit)}`;
        return `${v}${qty} → ${titleList(uniqueMeals(group.meals))}`;
      })
      .join(" · ");

    tasks.push({
      generation_key: `cut:${bucket.nn}`,
      kind: "cut",
      title,
      description,
      minutes: roundMinutes(TASK_OVERHEAD_MINUTES + bucket.work),
      is_passive: false,
      meals,
      per_recipe_minutes: Math.round(bucket.perRecipe),
      sort_order: 0,
    });
  }
  return tasks;
}

function grainKey(normalizedName: string): string | null {
  const last = normalizedName.split(" ").pop() ?? "";
  return last in GRAINS ? last : null;
}

function buildGrainTasks(usages: Usage[]): PrepDraftTask[] {
  type Grain = {
    nn: string;
    base: number;
    units: Set<string>;
    countable: boolean;
    meals: PrepMealRef[];
    perRecipe: number;
    family: string;
  };
  const grains = new Map<string, Grain>();

  for (const { meal, recipe, factor } of usages) {
    for (const ingredient of recipe.ingredients) {
      const family = grainKey(ingredient.normalized_name);
      if (!family || ingredient.grocery_section !== "Pantry") continue;
      const upper = ingredient.quantity_max ?? ingredient.quantity;
      const kind = unitKind(ingredient.unit);
      const measured = kind === "volume" || kind === "mass";
      const base = upper !== null && measured ? toBase(upper * factor, ingredient.unit) : 0;
      const grain = grains.get(ingredient.normalized_name) ?? {
        nn: ingredient.normalized_name,
        base: 0,
        units: new Set<string>(),
        countable: true,
        meals: [],
        perRecipe: 0,
        family,
      };
      if (upper !== null && measured) {
        grain.base += base;
        if (ingredient.unit) grain.units.add(ingredient.unit);
      } else {
        grain.countable = false;
      }
      grain.meals.push(ref(meal, recipe));
      const cups = kind === "volume" ? base / 236.588 : 0;
      grain.perRecipe += cups > 4 ? GRAINS[family]!.largeMinutes : GRAINS[family]!.minutes;
      grains.set(ingredient.normalized_name, grain);
    }
  }

  return [...grains.values()].map((grain) => {
    const volume = grain.units.size > 0 && [...grain.units].every((u) => unitKind(u) === "volume");
    const cups = volume ? grain.base / 236.588 : 0;
    const spec = GRAINS[grain.family]!;
    const minutes = cups > 4 ? spec.largeMinutes : spec.minutes;
    let amount = "";
    if (grain.countable && grain.base > 0 && grain.units.size > 0) {
      const picked = pickMeasured(grain.base, volume ? "volume" : "mass", [...grain.units]);
      amount = qtyLabel(picked.quantity, picked.unit);
    }
    return {
      generation_key: `grain:${grain.nn}`,
      kind: "grain" as const,
      title: ["Cook", amount, grain.nn].filter(Boolean).join(" "),
      description: null,
      minutes,
      is_passive: true,
      meals: uniqueMeals(grain.meals),
      per_recipe_minutes: Math.round(grain.perRecipe),
      sort_order: 0,
    };
  });
}

function buildRoastTasks(usages: Usage[]): PrepDraftTask[] {
  type Roast = {
    nn: string;
    names: Map<string, number>;
    meals: PrepMealRef[];
    notes: Set<string>;
    count: number;
  };
  const roasts = new Map<string, Roast>();

  for (const { meal, recipe } of usages) {
    for (const step of recipe.steps) {
      const text = step.instruction;
      if (!/\broast/i.test(text)) continue;
      if (PROTEIN_WORDS.test(text) || LAST_MINUTE.test(text)) continue; // one-pan dinners are cooked at dinner
      for (const ingredient of recipe.ingredients) {
        if (!ROASTABLE.has(ingredient.normalized_name) || !mentions(text, ingredient)) continue;
        const roast: Roast = roasts.get(ingredient.normalized_name) ?? {
          nn: ingredient.normalized_name,
          names: new Map<string, number>(),
          meals: [] as PrepMealRef[],
          notes: new Set<string>(),
          count: 0,
        };
        roast.names.set(ingredient.name, (roast.names.get(ingredient.name) ?? 0) + 1);
        roast.meals.push(ref(meal, recipe));
        roast.count += 1;
        const temp = /(\d{3})\s*°?\s*F\b/i.exec(text);
        const time = /(\d+)(?:\s*[–-]\s*(\d+))?\s*min/i.exec(text);
        if (temp)
          roast.notes.add(
            `${temp[1]}°F${time ? `, about ${time[2] ?? time[1]} min` : ""} per the recipe`,
          );
        roasts.set(ingredient.normalized_name, roast);
      }
    }
  }

  return [...roasts.values()].map((roast) => {
    const minutes = ROAST_MINUTES[roast.nn] ?? DEFAULT_ROAST_MINUTES;
    const top = [...roast.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? roast.nn;
    return {
      generation_key: `roast:${roast.nn}`,
      kind: "roast" as const,
      title: `Roast ${top}`,
      description: roast.notes.size > 0 ? [...roast.notes][0]! : null,
      minutes,
      is_passive: true,
      meals: uniqueMeals(roast.meals),
      per_recipe_minutes: minutes * uniqueMeals(roast.meals).length,
      sort_order: 0,
    };
  });
}

const SAUCE_NOUN =
  /\b(?:into|for|make|makes|to make)\s+(?:an?|the)?\s*(?:[a-z-]+\s+)?(sauce|dressing|glaze|marinade|vinaigrette|dip|spread)\b/i;

const NAME_ADJECTIVES = new Set([
  "greek",
  "plain",
  "white",
  "yellow",
  "brown",
  "dark",
  "light",
  "whole",
  "toasted",
  "low-sodium",
  "unsalted",
  "salted",
  "sweet",
  "smoked",
]);

/** "greek yogurt" → "yogurt", "white miso" → "miso": the short name a cook would say out loud. */
function shortName(name: string): string {
  const words = name.split(" ");
  while (words.length > 1 && NAME_ADJECTIVES.has(words[0]!)) words.shift();
  return words.join(" ");
}

/** The first ingredient named in the step that is not itself a sauce — "yogurt" in "yogurt sauce". */
function sauceBase(recipe: PlannableRecipe, step: string): string {
  const lower = step.toLowerCase();
  const hits = recipe.ingredients
    .map((ingredient) => ({
      ingredient,
      index: Math.min(
        ...nameTokens(ingredient).map((t) => {
          const i = lower.search(new RegExp(`\\b${t}\\b`));
          return i < 0 ? Infinity : i;
        }),
      ),
    }))
    .filter((hit) => Number.isFinite(hit.index))
    .sort((a, b) => a.index - b.index);
  const pick = hits[0]?.ingredient;
  return pick ? shortName(pick.normalized_name) : "";
}

function buildRecipeTasks(usages: Usage[]): PrepDraftTask[] {
  const tasks = new Map<string, PrepDraftTask>();

  const add = (
    key: string,
    draft: Omit<PrepDraftTask, "generation_key" | "sort_order" | "meals" | "per_recipe_minutes">,
    meal: PrepMealRef,
    each: number,
  ) => {
    const existing = tasks.get(key);
    if (existing) {
      existing.meals = uniqueMeals([...existing.meals, meal]);
      existing.minutes = draft.minutes + 2 * (existing.meals.length - 1); // a bigger batch, same bowl
      existing.per_recipe_minutes += each;
      return;
    }
    tasks.set(key, {
      ...draft,
      generation_key: key,
      meals: [meal],
      per_recipe_minutes: each,
      sort_order: 0,
    });
  };

  for (const { meal, recipe } of usages) {
    const mealRef = ref(meal, recipe);
    for (const step of recipe.steps) {
      const text = step.instruction.trim();
      if (!text) continue;

      // Sauces, dressings, glazes: a cold mix that keeps for days.
      const sauce = SAUCE_NOUN.exec(text);
      if (sauce && MIX_VERB.test(text) && !HEAT.test(text) && !LAST_MINUTE.test(text)) {
        const noun = sauce[1]!.toLowerCase();
        const base = sauceBase(recipe, text);
        const verb = noun === "glaze" || noun === "marinade" ? "Make" : "Mix";
        add(
          `sauce:${recipe.id}:${noun}`,
          {
            kind: "sauce",
            title: [verb, base, noun].filter(Boolean).join(" "),
            description: text,
            minutes: 5,
            is_passive: false,
          },
          mealRef,
          5,
        );
        continue;
      }

      // Marinades: combine and coat now, cook later.
      if (/\bmarinat/i.test(text) && !LAST_MINUTE.test(text)) {
        const protein =
          recipe.ingredients.find(
            (i) => i.grocery_section === "Meat & Seafood" && mentions(text, i),
          ) ?? recipe.ingredients.find((i) => i.grocery_section === "Meat & Seafood");
        add(
          `marinate:${recipe.id}`,
          {
            kind: "marinate",
            title: `Marinate ${protein ? protein.name : recipe.title}`,
            description: text,
            minutes: 5,
            is_passive: false,
          },
          mealRef,
          5,
        );
        continue;
      }

      // Dry mixes (pancake or muffin dry ingredients): whisk once, bag it.
      const dry = /^(?:in an? [a-z ]+bowl,?\s*)?(whisk|mix|stir|combine|sift)\b/i.test(text);
      const dryWords = (
        text.match(
          /\b(flour|sugar|baking powder|baking soda|salt|cocoa|oats|cornstarch|cumin|paprika|cinnamon|nutmeg|chili powder|garlic powder|onion powder)\b/gi,
        ) ?? []
      ).length;
      const wet =
        /\b(egg|eggs|milk|butter|oil|water|yogurt|buttermilk|cream|juice|vanilla|honey|syrup|broth|sauce|vinegar)\b/i.test(
          text,
        );
      if (dry && dryWords >= 2 && !wet) {
        add(
          `mix:${recipe.id}`,
          {
            kind: "mix",
            title: `Mix dry ingredients for ${recipe.title}`,
            description: text,
            minutes: 5,
            is_passive: false,
          },
          mealRef,
          5,
        );
        continue;
      }

      // Portioning cooked food into containers.
      if (
        /\b(portion|divide)\b[^.]*\b(into|among)\b[^.]*\b(containers?|portions|meal[- ]prep)/i.test(
          text,
        )
      ) {
        add(
          `portion:${recipe.id}`,
          {
            kind: "portion",
            title: `Portion ${recipe.title}`,
            description: text,
            minutes: 10,
            is_passive: false,
          },
          mealRef,
          10,
        );
      }
    }
  }
  return [...tasks.values()];
}

/** Longest passive time first, so active work fills the wait — but a cut always precedes its roast. */
function orderTasks(tasks: PrepDraftTask[]): PrepDraftTask[] {
  const byKey = new Map(tasks.map((t) => [t.generation_key, t]));
  const out: PrepDraftTask[] = [];
  const done = new Set<string>();
  const push = (task: PrepDraftTask | undefined) => {
    if (task && !done.has(task.generation_key)) {
      done.add(task.generation_key);
      out.push(task);
    }
  };
  const byMinutesDesc = (a: PrepDraftTask, b: PrepDraftTask) =>
    b.minutes - a.minutes || a.title.localeCompare(b.title);

  const grains = tasks.filter((t) => t.kind === "grain").sort(byMinutesDesc);
  const roasts = tasks.filter((t) => t.kind === "roast").sort(byMinutesDesc);
  const cuts = tasks.filter((t) => t.kind === "cut").sort(byMinutesDesc);
  const recipeTasks = tasks
    .filter((t) => t.kind === "sauce" || t.kind === "marinate" || t.kind === "mix")
    .sort((a, b) => a.title.localeCompare(b.title));
  const portions = tasks
    .filter((t) => t.kind === "portion")
    .sort((a, b) => a.title.localeCompare(b.title));

  // 1. Hands-off tasks with nothing to cut first start immediately.
  for (const grain of grains) push(grain);
  // 2. Roasts, each preceded by its own cutting.
  for (const roast of roasts) {
    push(byKey.get(`cut:${roast.generation_key.slice("roast:".length)}`));
    push(roast);
  }
  // 3. Everything else that needs a knife.
  for (const cut of cuts) push(cut);
  // 4. Cold mixes and marinades last, once the chopping is done.
  for (const task of recipeTasks) push(task);
  for (const task of portions) push(task);

  return out.map((task, index) => ({ ...task, sort_order: index }));
}

/**
 * Generates the week's consolidated prep tasks. It never throws: a recipe whose text cannot be
 * analysed simply contributes nothing (the Prep screen always offers manual tasks).
 */
export function generatePrep(meals: MealInput[]): PrepDraftTask[] {
  const usages: Usage[] = [];
  const ordered = [...meals].sort(
    (a, b) => a.planned_date.localeCompare(b.planned_date) || a.id.localeCompare(b.id),
  );
  for (const meal of ordered) {
    usages.push({
      meal,
      recipe: meal.recipe,
      factor: scaleFactor(meal.recipe.servings, meal.servings),
    });
  }

  const tasks: PrepDraftTask[] = [];
  for (const build of [buildGrainTasks, buildRoastTasks, buildCutTasks, buildRecipeTasks]) {
    try {
      tasks.push(...build(usages));
    } catch (error) {
      console.error("prep generation step failed", error);
    }
  }
  return orderTasks(tasks);
}

// ─────────────────────────────── summaries ───────────────────────────────

export type PrepSummary = {
  taskCount: number;
  totalMinutes: number;
  passiveMinutes: number;
  activeMinutes: number;
  /** Estimated minutes saved versus prepping each recipe on its own. */
  savedMinutes: number;
};

export function summarizePrep(
  tasks: Pick<PrepDraftTask, "minutes" | "is_passive" | "per_recipe_minutes">[],
): PrepSummary {
  const totalMinutes = tasks.reduce((sum, task) => sum + task.minutes, 0);
  const passiveMinutes = tasks
    .filter((t) => t.is_passive)
    .reduce((sum, task) => sum + task.minutes, 0);
  const savedMinutes = tasks.reduce(
    (sum, task) => sum + Math.max(0, task.per_recipe_minutes - task.minutes),
    0,
  );
  return {
    taskCount: tasks.length,
    totalMinutes,
    passiveMinutes,
    activeMinutes: totalMinutes - passiveMinutes,
    savedMinutes,
  };
}

/** "Sun 28 · Tue, Thu" style label for where a task is used. */
export function usedInLabel(meals: PrepMealRef[]): string {
  return meals.map((m) => `${m.title} (${shortDay(m.day)})`).join(", ");
}

/** The chip on a meal card: No prep · 1/3 prepped · Prepped. */
export function mealPrepStatus(
  mealId: string,
  tasks: { is_completed: boolean; meal_ids: string[] }[],
): { state: "none" | "partial" | "done"; done: number; total: number; label: string } {
  const mine = tasks.filter((task) => task.meal_ids.includes(mealId));
  if (mine.length === 0) return { state: "none", done: 0, total: 0, label: "No prep" };
  const done = mine.filter((task) => task.is_completed).length;
  if (done === mine.length) return { state: "done", done, total: mine.length, label: "Prepped" };
  return { state: "partial", done, total: mine.length, label: `${done}/${mine.length} prepped` };
}

// ─────────────────────────────── regeneration merge ───────────────────────────────

export type ExistingPrepTask = {
  id: string;
  generation_key: string | null;
  title: string;
  description: string | null;
  minutes: number;
  is_passive: boolean;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  is_custom: boolean;
  is_edited: boolean;
};

export type MergedPrepTask = {
  /** Existing row to update, or null to insert. */
  id: string | null;
  generation_key: string | null;
  title: string;
  description: string | null;
  minutes: number;
  is_passive: boolean;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  is_custom: boolean;
  is_edited: boolean;
  /** Meal links to replace; null = leave the task's existing links alone. */
  meals: PrepMealRef[] | null;
};

export type PrepMergeResult = {
  tasks: MergedPrepTask[];
  deleteIds: string[];
  clearMealsFor: string[];
};

/**
 * Merges a fresh generation into the existing plan, keeping manual changes: custom tasks, edited
 * wording and minutes, completion, and (once the person has reordered) their order.
 * An edited task whose meals left the week becomes a custom task instead of vanishing.
 */
export function mergePrepRegeneration(
  existing: ExistingPrepTask[],
  drafts: PrepDraftTask[],
  options: { manuallyOrdered: boolean },
): PrepMergeResult {
  const byKey = new Map<string, ExistingPrepTask>();
  const deleteIds: string[] = [];
  for (const task of existing) {
    if (task.is_custom || !task.generation_key) continue;
    if (byKey.has(task.generation_key)) deleteIds.push(task.id);
    else byKey.set(task.generation_key, task);
  }

  const used = new Set<string>();
  const generated: MergedPrepTask[] = [];
  const fresh: MergedPrepTask[] = [];

  for (const draft of drafts) {
    const current = byKey.get(draft.generation_key);
    if (!current) {
      fresh.push({
        id: null,
        generation_key: draft.generation_key,
        title: draft.title,
        description: draft.description,
        minutes: draft.minutes,
        is_passive: draft.is_passive,
        sort_order: draft.sort_order,
        is_completed: false,
        completed_at: null,
        is_custom: false,
        is_edited: false,
        meals: draft.meals,
      });
      continue;
    }
    used.add(current.id);
    generated.push({
      id: current.id,
      generation_key: draft.generation_key,
      title: current.is_edited ? current.title : draft.title,
      description: current.is_edited ? current.description : draft.description,
      minutes: current.is_edited ? current.minutes : draft.minutes,
      is_passive: draft.is_passive,
      sort_order: manuallyOrderedIndex(current, options),
      is_completed: current.is_completed,
      completed_at: current.completed_at,
      is_custom: false,
      is_edited: current.is_edited,
      meals: draft.meals,
    });
  }

  const converted: MergedPrepTask[] = [];
  const clearMealsFor: string[] = [];
  for (const task of existing) {
    if (task.is_custom || !task.generation_key || used.has(task.id) || deleteIds.includes(task.id))
      continue;
    if (task.is_edited) {
      converted.push({
        ...task,
        generation_key: null,
        is_custom: true,
        is_edited: false,
        meals: null,
      });
      clearMealsFor.push(task.id);
    } else {
      deleteIds.push(task.id);
    }
  }

  const customs: MergedPrepTask[] = existing
    .filter((task) => task.is_custom)
    .map((task) => ({ ...task, meals: null as PrepMealRef[] | null }));

  let ordered: MergedPrepTask[];
  if (options.manuallyOrdered) {
    // Keep the person's order; new tasks go at the end.
    const kept = [...generated, ...converted, ...customs].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    ordered = [...kept, ...fresh];
  } else {
    // Algorithm order for generated tasks; the person's own tasks follow.
    const byKeyOrder = [...generated, ...fresh].sort(
      (a, b) => draftOrder(drafts, a) - draftOrder(drafts, b),
    );
    ordered = [
      ...byKeyOrder,
      ...[...converted, ...customs].sort((a, b) => a.sort_order - b.sort_order),
    ];
  }

  return {
    tasks: ordered.map((task, index) => ({ ...task, sort_order: index })),
    deleteIds,
    clearMealsFor,
  };
}

function manuallyOrderedIndex(
  task: ExistingPrepTask,
  options: { manuallyOrdered: boolean },
): number {
  return options.manuallyOrdered ? task.sort_order : 0;
}

function draftOrder(drafts: PrepDraftTask[], task: MergedPrepTask): number {
  const index = drafts.findIndex((draft) => draft.generation_key === task.generation_key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
