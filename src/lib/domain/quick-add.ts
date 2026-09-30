import {
  cleanDisplayName,
  normalizeIngredientName,
  parseIngredientLine,
  sentenceCase,
} from "./ingredients";

export type QuickAddItem = {
  /** Display name, e.g. "Chicken thighs". */
  name: string;
  normalized_name: string;
  /** null = "have some". */
  quantity: number | null;
  unit: string | null;
};

/**
 * Parses the kitchen / grocery quick-add box: `2 onions`, `1 lb chicken thighs`, `rice`,
 * `1½ cups olive oil`. Anything that does not parse as a measured ingredient is kept as typed —
 * quick add never refuses a line.
 */
export function parseQuickAdd(text: string): QuickAddItem | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  for (const parsed of parseIngredientLine(trimmed)) {
    if (parsed.kind !== "ingredient") continue;
    const { quantity, quantity_max, unit, name, normalized_name } = parsed.ingredient;
    return {
      name: sentenceCase(name),
      normalized_name,
      quantity: quantity_max ?? quantity,
      unit,
    };
  }
  return {
    name: sentenceCase(cleanDisplayName(trimmed)),
    normalized_name: normalizeIngredientName(trimmed),
    quantity: null,
    unit: null,
  };
}

/** One item per line (or per semicolon), for pasted lists. */
export function parseQuickAddLines(text: string): QuickAddItem[] {
  return text
    .split(/[\n;]+/)
    .map((line) => parseQuickAdd(line))
    .filter((item): item is QuickAddItem => item !== null);
}

/** Lenient number entry for quantity fields: "1 1/2", "½", "1.5", "3/4". */
export function parseLooseNumber(input: string): number | null {
  const text = input.trim().replace(/[⁄]/g, "/");
  if (!text) return null;
  const vulgar: Record<string, number> = {
    "½": 0.5,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "¼": 0.25,
    "¾": 0.75,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875,
  };
  const glyph = /([½⅓⅔¼¾⅛⅜⅝⅞])/.exec(text);
  if (glyph) {
    const whole = Number(text.slice(0, glyph.index).trim() || 0);
    if (Number.isNaN(whole)) return null;
    return whole + vulgar[glyph[1]!]!;
  }
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
