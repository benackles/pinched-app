/**
 * schema.org/Recipe → Pinched's recipe shape.
 *
 * Copyright posture (PRD): a bare ingredient list and functional directions are facts; a
 * headnote, expressive prose and photos are not ours to copy. So this reads exactly what the PRD
 * lists — ingredients, instructions (including HowToSection), yield, times, image, author — and
 * deliberately ignores `description`. The source URL is kept and the author credited.
 */
import { parseIngredientList, type ParsedIngredient } from "../domain/ingredients";
import { parseYield } from "../domain/scaling";
import { parseIsoDuration } from "./duration";

export type ImportedRecipe = {
  title: string;
  author: string | null;
  source_url: string;
  image_url: string | null;
  servings: number | null;
  servings_label: string | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  ingredients: ParsedIngredient[];
  steps: string[];
  /** Things worth a second look in the preview (missing yield, lines with no amount, …). */
  warnings: string[];
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "–",
  mdash: "—",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
};

/** Plain text from a string that may contain tags and entities. */
export function toPlainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function hasType(node: Json, type: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase() === type.toLowerCase();
  if (Array.isArray(t))
    return t.some((x) => typeof x === "string" && x.toLowerCase() === type.toLowerCase());
  return false;
}

/** Depth-first search through @graph, arrays, mainEntity and nested objects for the first Recipe. */
export function findRecipeNode(root: unknown): Json | null {
  let visited = 0;
  const walk = (node: unknown, depth: number): Json | null => {
    if (depth > 8 || visited++ > 5000) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (!isObject(node)) return null;
    if (hasType(node, "Recipe")) return node;
    for (const key of [
      "@graph",
      "mainEntity",
      "mainEntityOfPage",
      "itemListElement",
      "item",
      "hasPart",
    ]) {
      const found = walk(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(root, 0);
}

function textOf(value: unknown): string {
  if (typeof value === "string") return toPlainText(value);
  if (isObject(value)) return toPlainText(value.text ?? value.name ?? "");
  return "";
}

/** recipeInstructions: a string, a list of strings, HowToStep[], or HowToSection[] (nested). */
export function normalizeInstructions(value: unknown): string[] {
  const steps: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || node === undefined) return;
    if (typeof node === "string") {
      const text = toPlainText(node);
      // One blob of text: split on line breaks or on "1. … 2. …" numbering.
      const lines = text.includes("\n")
        ? text.split("\n")
        : /(?:^|\s)\d+[.)]\s+\S/.test(text) && /\s2[.)]\s/.test(text)
          ? text.split(/\s*(?:^|\s)\d+[.)]\s+/).filter(Boolean)
          : [text];
      for (const line of lines) {
        const cleaned = line.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, "").trim();
        if (cleaned) steps.push(cleaned);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
    } else if (isObject(node)) {
      if (hasType(node, "HowToSection") || Array.isArray(node.itemListElement)) {
        visit(node.itemListElement, depth + 1);
      } else {
        const text = textOf(node);
        if (text) visit(text, depth + 1);
      }
    }
  };
  visit(value, 0);
  return steps;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return null;
}

function imageUrl(value: unknown, base: string): string | null {
  const candidate = (() => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = imageUrl(item, base);
        if (found) return found;
      }
      return null;
    }
    if (isObject(value)) return firstString(value.url ?? value.contentUrl);
    return null;
  })();
  if (!candidate) return null;
  try {
    const url = new URL(candidate, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function authorName(value: unknown): string | null {
  const names: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const name = toPlainText(node);
      if (name) names.push(name);
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (isObject(node)) visit(node.name);
  };
  visit(value);
  const unique = [...new Set(names)].slice(0, 3);
  return unique.length ? unique.join(", ") : null;
}

function asList(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\n+/).map(toPlainText).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(asList);
  if (isObject(value)) return asList(value.text ?? value.name);
  return [];
}

/** Maps a schema.org Recipe node to an ImportedRecipe, or null when it has no usable content. */
export function mapRecipe(
  node: Json,
  sourceUrl: string,
  fallbackTitle: string | null,
): ImportedRecipe | null {
  const title = toPlainText(typeof node.name === "string" ? node.name : "") || fallbackTitle || "";
  const ingredientLines = asList(node.recipeIngredient ?? node.ingredients);
  const steps = normalizeInstructions(node.recipeInstructions);
  if (!title || (ingredientLines.length === 0 && steps.length === 0)) return null;

  const ingredients = parseIngredientList(ingredientLines);
  const { servings, label } = parseYield(
    firstString(node.recipeYield) ??
      (typeof node.recipeYield === "number" ? node.recipeYield : null),
  );
  const prep = parseIsoDuration(node.prepTime);
  const cook = parseIsoDuration(node.cookTime);
  const total =
    parseIsoDuration(node.totalTime) ??
    (prep !== null || cook !== null ? (prep ?? 0) + (cook ?? 0) : null);

  const warnings: string[] = [];
  if (ingredients.length === 0)
    warnings.push("No ingredients were found — add them before saving.");
  if (steps.length === 0) warnings.push("No directions were found — add them before saving.");
  if (servings === null)
    warnings.push("The servings weren't listed, so quantities won't scale until you set them.");
  const unmeasured = ingredients.filter((i) => i.quantity === null).length;
  if (ingredients.length > 0 && unmeasured > Math.max(3, ingredients.length / 2)) {
    warnings.push(`${unmeasured} ingredients have no amount — they'll be listed by name.`);
  }

  return {
    title,
    author: authorName(node.author),
    source_url: sourceUrl,
    image_url: imageUrl(node.image, sourceUrl),
    servings,
    servings_label: label,
    prep_minutes: prep,
    cook_minutes: cook,
    total_minutes: total,
    ingredients,
    steps,
    warnings,
  };
}
