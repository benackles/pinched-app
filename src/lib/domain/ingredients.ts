/**
 * Turns recipe text into structured ingredients, and ingredient names into merge keys.
 *
 * `parse-ingredient` does the heavy lifting (quantities, ranges, fractions, units, group
 * headers). This module adds what recipes actually throw at it: sized cans, "salt and pepper",
 * "juice of 1 lemon", prep notes after a comma, curated synonyms, and the grocery aisle.
 */
import { parseIngredient, type ParseIngredientOptions } from "parse-ingredient";

import type { GrocerySection } from "./constants";
import {
  DROP_PHRASES,
  DROP_WORDS,
  SYNONYMS,
  classifySection,
  singularize,
} from "./ingredient-data";
import { canonicalUnit, formatQuantity, unitLabel } from "./units";

export type ParsedIngredient = {
  quantity: number | null;
  /** Upper end of a range ("2–3 cloves"). The grocery list buys the upper end. */
  quantity_max: number | null;
  unit: string | null;
  /** As the recipe names it, lowercase, minus filler words — "yellow onion". */
  name: string;
  /** The merge key — "onion". */
  normalized_name: string;
  preparation: string | null;
  /** The line exactly as written. */
  raw_text: string;
  grocery_section: GrocerySection;
  group_label: string | null;
};

/** The ingredient fields the rest of the domain layer works with. */
export type IngredientLike = Pick<
  ParsedIngredient,
  | "quantity"
  | "quantity_max"
  | "unit"
  | "name"
  | "normalized_name"
  | "preparation"
  | "raw_text"
  | "grocery_section"
>;

// ─────────────────────────────── normalization ───────────────────────────────

/** Leading amount words that are not part of the food's name: "a little basil", "some butter". */
function stripLeadingAmountWords(words: string[]): string[] {
  const out = [...words];
  while (out.length > 1) {
    const first = out[0]!;
    const second = out[1] ?? "";
    if (first === "a" || first === "an" || first === "of") {
      out.shift();
    } else if (
      ["some", "few", "several", "little", "bit", "touch"].includes(first) &&
      !(first === "little" && ["gem", "neck", "necks"].includes(second)) // little gem lettuce, littleneck clams
    ) {
      out.shift();
    } else {
      break;
    }
  }
  return out;
}

/**
 * The merge key for an ingredient name. Drops words that never change the product, singularizes
 * the last word, then applies the curated synonym map:
 *   "Yellow onions" → "onion" · "green onion" → "scallion" · "EVOO" → "olive oil"
 *   "boneless skinless chicken thighs" → "boneless skinless chicken thigh" (kept distinct on purpose)
 */
export function normalizeIngredientName(input: string): string {
  let text = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // jalapeño → jalapeno
    .replace(/[’‘]/g, "'")
    .replace(/\([^)]*\)/g, " ");
  for (const phrase of DROP_PHRASES) text = text.replace(phrase, " ");
  text = text.replace(/[^a-z0-9'\s-]/g, " ");

  const words = stripLeadingAmountWords(
    text
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => !DROP_WORDS.has(word)),
  );

  const phrase = singularize(words.join(" ").trim());
  return SYNONYMS[phrase] ?? SYNONYMS[phrase.replace(/-/g, " ")] ?? phrase;
}

/** A human-friendly lowercase name: the recipe's own words minus filler ("fresh", "large"). */
export function cleanDisplayName(input: string): string {
  let text = input.toLowerCase().replace(/\([^)]*\)/g, " ");
  for (const phrase of DROP_PHRASES) text = text.replace(phrase, " ");
  const words = stripLeadingAmountWords(
    text
      .replace(/[^a-z0-9'\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => !DROP_WORDS.has(word)),
  );
  return words.join(" ").trim() || input.toLowerCase().trim();
}

export function sentenceCase(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "onion" → "onions", "chicken thigh" → "chicken thighs". Only for names that are count nouns. */
export function pluralizeName(name: string): string {
  const words = name.split(" ");
  const last = words.pop() ?? "";
  let plural: string;
  if (/(ch|sh|s|x|z)$/.test(last)) plural = `${last}es`;
  else if (/[^aeiou]y$/.test(last)) plural = `${last.slice(0, -1)}ies`;
  else if (/(?:tomato|potato|mango|avocado|radish)$/.test(last) && !last.endsWith("radish"))
    plural = `${last}es`;
  else plural = `${last}s`;
  return [...words, plural].join(" ");
}

// ─────────────────────────────── parsing ───────────────────────────────

const PARSE_OPTIONS: ParseIngredientOptions = {
  // Sizes describe the item ("1 large egg"); they are not units.
  ignoreUOMs: ["large", "medium", "small", "lg", "md", "sm", "med", "lg.", "md.", "sm.", "med."],
  leadingQuantityPrefixes: ["about", "approximately", "approx.", "around", "roughly"],
  additionalUOMs: {
    slice: { short: "slice", plural: "slices", type: "count" },
    fillet: { short: "fillet", plural: "fillets", alternates: ["filet", "filets"], type: "count" },
    stalk: { short: "stalk", plural: "stalks", type: "count" },
    strip: { short: "strip", plural: "strips", type: "count" },
    sheet: { short: "sheet", plural: "sheets", type: "count" },
    loaf: { short: "loaf", plural: "loaves", type: "count" },
    bulb: { short: "bulb", plural: "bulbs", type: "count" },
    rib: { short: "rib", plural: "ribs", type: "count" },
    jar: { short: "jar", plural: "jars", type: "count" },
    bottle: { short: "bottle", plural: "bottles", type: "count" },
    handful: { short: "handful", plural: "handfuls", type: "count" },
    splash: { short: "splash", plural: "splashes", type: "count" },
  },
};

const SIZE_UNIT_PATTERN = "fl\\.? ?oz|ounces?|oz|grams?|g|kg|pounds?|lbs?|liters?|litres?|ml|l";
const CONTAINER_PATTERN = "can|jar|bottle|bag|box|package|carton|container|pack";
const CONTAINERS = new Set([
  "can",
  "jar",
  "bottle",
  "bag",
  "box",
  "package",
  "carton",
  "container",
  "pack",
]);

// "(14-oz) can diced tomatoes" · "(15 oz each) black beans"
const SIZE_IN_PARENS = new RegExp(
  `^\\(\\s*(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${SIZE_UNIT_PATTERN})\\.?(?:\\s*each)?\\s*\\)\\s*(?:(${CONTAINER_PATTERN})s?\\b)?\\s*(.*)$`,
  "i",
);
// "28-oz can whole peeled tomatoes"
const SIZE_INLINE = new RegExp(
  `^(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${SIZE_UNIT_PATTERN})\\.?\\s+(${CONTAINER_PATTERN})s?\\b\\s*(.*)$`,
  "i",
);

function sizeShort(unit: string): string {
  const u = unit.toLowerCase().replace(/\./g, "");
  if (/^fl ?oz$/.test(u)) return "fl oz";
  if (/^(ounces?|oz)$/.test(u)) return "oz";
  if (/^(grams?|g)$/.test(u)) return "g";
  if (u === "kg") return "kg";
  if (/^(pounds?|lbs?)$/.test(u)) return "lb";
  if (/^(liters?|litres?|l)$/.test(u)) return "l";
  return "ml";
}

function extractSizedContainer(
  description: string,
  unit: string | null,
): { unit: string | null; description: string } {
  const match = SIZE_IN_PARENS.exec(description) ?? SIZE_INLINE.exec(description);
  if (!match) return { unit, description };
  const [, size, sizeUnit, container, rest] = match;
  const containerUnit = container?.toLowerCase() ?? (unit && CONTAINERS.has(unit) ? unit : null);
  if (containerUnit && size && sizeUnit) {
    return {
      unit: `${size}-${sizeShort(sizeUnit)} ${containerUnit}`,
      description: (rest ?? "").trim(),
    };
  }
  // "3 (8-ounce) salmon fillets": the size is a note on each item, not a unit.
  return { unit, description: (rest ?? description).trim() };
}

const LEADING_PREP =
  /^((?:(?:finely|roughly|coarsely|thinly|thickly|freshly|lightly|very)\s+)?(?:chopped|diced|minced|sliced|grated|shredded|crushed|cubed|peeled|halved|quartered|mashed|melted|softened|toasted|cooked|drained|rinsed|beaten|julienned|trimmed|torn|crumbled|zested|juiced)(?:(?:,|\s+and|\s+&)\s+(?:(?:finely|roughly|coarsely|thinly|thickly|freshly|lightly)\s+)?(?:chopped|diced|minced|sliced|grated|shredded|crushed|cubed|peeled|halved|quartered|mashed|melted|softened|toasted|cooked|drained|rinsed|beaten|julienned|trimmed|torn|crumbled))*)\s+(.+)$/i;

/**
 * "diced tomatoes" in a can, "crushed red pepper": the word describes the PRODUCT, not something
 * the cook has to do, so it stays in the name.
 */
const PRODUCT_FORM =
  /^(?:(?:crushed|diced|stewed|petite diced|whole peeled)\s+tomato(?:es)?\b|crushed\s+red\s+pepper)/i;

/** "onion, diced" → { name: "onion", preparation: "diced" } · "chopped fresh dill" → dill / chopped */
function splitDescription(description: string): { name: string; preparation: string | null } {
  const text = description
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const [head = "", ...rest] = text.split(/\s*,\s*/);
  let name = head.trim();
  const tail = rest.join(", ").trim();
  const preps: string[] = [];

  const lead = PRODUCT_FORM.test(name) ? null : LEADING_PREP.exec(name);
  if (lead) {
    preps.push(lead[1]!.toLowerCase());
    name = lead[2]!.trim();
  }
  if (tail) preps.push(tail.toLowerCase());
  return { name, preparation: preps.length ? preps.join(", ") : null };
}

const SALT_AND_PEPPER =
  /^(?:(?:kosher|sea|fine|coarse|flaky)\s+)?salt\s*(?:and|&)\s*(?:(?:freshly|fresh)\s+)?(?:ground\s+)?(?:(?:black|white)\s+)?pepper\b[\s,]*(.*)$/i;

const JUICE_OR_ZEST =
  /^(juice and zest|zest and juice|juice|zest)\s+of\s+(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+|half an?|half|an?|one)?\s*(lemon|lime|orange|grapefruit)s?\b.*$/i;

const A_UNIT_OF =
  /^(?:an?|one)\s+(handful|pinch|dash|splash|bunch|sprig|stick|can|jar|head|clove)\s+(?:of\s+)?(.+)$/i;

type Expanded = { text: string; extraPrep?: string };

/** Lines that need rewriting before the generic parser sees them. */
function expand(raw: string): Expanded[] {
  const pepper = SALT_AND_PEPPER.exec(raw);
  if (pepper) {
    const note = (pepper[1] ?? "").trim() || "to taste";
    return [
      { text: "salt", extraPrep: note },
      { text: "black pepper", extraPrep: note },
    ];
  }

  const citrus = JUICE_OR_ZEST.exec(raw);
  if (citrus) {
    const what = citrus[1]!.toLowerCase();
    const amount = (citrus[2] ?? "1").toLowerCase();
    const fruit = citrus[3]!.toLowerCase();
    const qty = /^half/.test(amount) ? "1/2" : /^(an?|one)$/.test(amount) ? "1" : amount;
    const prep = what === "juice" ? "juiced" : what === "zest" ? "zested" : "juiced and zested";
    return [{ text: `${qty} ${fruit}`, extraPrep: prep }];
  }

  const aUnit = A_UNIT_OF.exec(raw);
  if (aUnit) return [{ text: `1 ${aUnit[1]} ${aUnit[2]}` }];

  return [{ text: raw }];
}

export type ParsedLine =
  { kind: "header"; label: string } | { kind: "ingredient"; ingredient: ParsedIngredient };

function parseOne(text: string, raw: string, extraPrep?: string): ParsedLine | null {
  const [parsed] = parseIngredient(text, PARSE_OPTIONS);
  if (!parsed) return null;
  if (parsed.isGroupHeader) {
    return { kind: "header", label: parsed.description.replace(/:\s*$/, "").trim() };
  }

  let description = parsed.description;
  let unit = canonicalUnit(parsed.unitOfMeasureID ?? parsed.unitOfMeasure);
  // A unit word we do not recognise goes back where it was rather than vanishing.
  if (parsed.unitOfMeasure && !unit) description = `${parsed.unitOfMeasure} ${description}`;

  ({ unit, description } = extractSizedContainer(description, unit));
  const { name: rawName, preparation: prep } = splitDescription(description);
  const preparation = [prep, extraPrep].filter(Boolean).join(", ") || null;

  const name = cleanDisplayName(rawName);
  if (!name) return null;
  const normalized = normalizeIngredientName(rawName);

  let section = classifySection(normalized);
  // Canned and jarred goods live in the pantry whatever is inside.
  if (
    unit &&
    /(^|\s)(can|jar)$/.test(unit) &&
    (section === "Produce" || section === "Other" || section === "Meat & Seafood")
  ) {
    section = "Pantry";
  }

  return {
    kind: "ingredient",
    ingredient: {
      quantity: parsed.quantity,
      quantity_max: parsed.quantity2,
      unit,
      name,
      normalized_name: normalized || name,
      preparation,
      raw_text: raw,
      grocery_section: section,
      group_label: null,
    },
  };
}

function cleanRaw(input: string): string {
  return input
    .replace(/[   ]/g, " ")
    .replace(/⁄/g, "/") // fraction slash
    .replace(/\s+/g, " ")
    .trim();
}

/** Parses one recipe line into zero or more lines (headers and/or ingredients). */
export function parseIngredientLine(rawInput: string): ParsedLine[] {
  const raw = cleanRaw(rawInput);
  if (!raw) return [];
  const out: ParsedLine[] = [];
  for (const piece of expand(raw)) {
    const parsed = parseOne(piece.text, raw, piece.extraPrep);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Parses a whole ingredient list, applying group headers ("For the sauce:") to the lines below. */
export function parseIngredientList(lines: readonly string[]): ParsedIngredient[] {
  const out: ParsedIngredient[] = [];
  let group: string | null = null;
  for (const line of lines) {
    for (const parsed of parseIngredientLine(line)) {
      if (parsed.kind === "header") group = parsed.label || null;
      else out.push({ ...parsed.ingredient, group_label: group });
    }
  }
  return out;
}

/**
 * Like `parseIngredientList`, but a line the parser cannot read is kept as typed (no quantity)
 * instead of vanishing — used for anything a person enters or imports, where "never silently
 * drop an ingredient" applies.
 */
export function parseIngredientListLossless(lines: readonly string[]): ParsedIngredient[] {
  const out: ParsedIngredient[] = [];
  let group: string | null = null;
  for (const line of lines) {
    const parsedLines = parseIngredientLine(line);
    if (parsedLines.length === 0) {
      const text = cleanRaw(line);
      if (!text) continue;
      const normalized = normalizeIngredientName(text) || text.toLowerCase();
      out.push({
        quantity: null,
        quantity_max: null,
        unit: null,
        name: cleanDisplayName(text) || text,
        normalized_name: normalized,
        preparation: null,
        raw_text: text,
        grocery_section: classifySection(normalized),
        group_label: group,
      });
      continue;
    }
    for (const parsed of parsedLines) {
      if (parsed.kind === "header") group = parsed.label || null;
      else out.push({ ...parsed.ingredient, group_label: group });
    }
  }
  return out;
}

// ─────────────────────────────── display ───────────────────────────────

/** "1½ cups jasmine rice, sliced" — falls back to the recipe's own wording when there is no number. */
export function formatIngredient(ingredient: {
  quantity: number | null;
  quantity_max?: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  raw_text?: string;
}): string {
  const { quantity, quantity_max: max, unit, name, preparation } = ingredient;
  if (quantity === null) return ingredient.raw_text?.trim() || sentenceCase(name);
  const amount =
    max !== null && max !== undefined && max > quantity
      ? `${formatQuantity(quantity)}–${formatQuantity(max)}`
      : formatQuantity(quantity);
  const label = unitLabel(unit, max ?? quantity);
  const line = [amount, label, name].filter(Boolean).join(" ");
  return preparation ? `${line}, ${preparation}` : line;
}

/** Builds a complete ingredient from form fields (manual recipe entry, personal versions). */
export function buildIngredient(fields: {
  quantity?: number | null;
  quantity_max?: number | null;
  unit?: string | null;
  name: string;
  preparation?: string | null;
  grocery_section?: GrocerySection;
}): ParsedIngredient {
  const name = cleanDisplayName(fields.name);
  const normalized = normalizeIngredientName(fields.name) || name;
  const unit =
    canonicalUnit(fields.unit ?? null) ??
    (fields.unit?.trim() ? fields.unit.trim().toLowerCase() : null);
  const preparation = fields.preparation?.trim() || null;
  const quantity = fields.quantity ?? null;
  const quantity_max = fields.quantity_max ?? null;
  return {
    quantity,
    quantity_max,
    unit,
    name,
    normalized_name: normalized,
    preparation,
    raw_text: formatIngredient({ quantity, quantity_max, unit, name, preparation }),
    grocery_section: fields.grocery_section ?? classifySection(normalized),
    group_label: null,
  };
}
