/**
 * Units, families and conversion.
 *
 * Only three kinds of amounts may be combined or subtracted:
 *   - "each"   — no unit (2 onions)
 *   - volume   — tsp, tbsp, cup, … (convertible within the family)
 *   - mass     — oz, lb, g, kg (convertible within the family)
 * Everything else (a clove, a bunch, a 14-oz can, a pinch) is a NAMED unit that only combines
 * with the very same unit. "2 cups spinach" and "1 bag spinach" therefore stay separate rows —
 * Pinched never guesses a density or a bag size.
 */

export type UnitKind = "each" | "volume" | "mass" | "named";

type Measured = { id: string; short: string; kind: "volume" | "mass"; factor: number };

/** Canonical measured units. `factor` converts to ml (volume) or g (mass). Stored unit = `short`. */
const MEASURED: Measured[] = [
  { id: "teaspoon", short: "tsp", kind: "volume", factor: 4.92892 },
  { id: "tablespoon", short: "tbsp", kind: "volume", factor: 14.7868 },
  { id: "fluid ounce", short: "fl oz", kind: "volume", factor: 29.5735 },
  { id: "cup", short: "cup", kind: "volume", factor: 236.588 },
  { id: "pint", short: "pt", kind: "volume", factor: 473.176 },
  { id: "quart", short: "qt", kind: "volume", factor: 946.353 },
  { id: "gallon", short: "gal", kind: "volume", factor: 3785.41 },
  { id: "milliliter", short: "ml", kind: "volume", factor: 1 },
  { id: "deciliter", short: "dl", kind: "volume", factor: 100 },
  { id: "liter", short: "l", kind: "volume", factor: 1000 },
  { id: "ounce", short: "oz", kind: "mass", factor: 28.3495 },
  { id: "pound", short: "lb", kind: "mass", factor: 453.592 },
  { id: "gram", short: "g", kind: "mass", factor: 1 },
  { id: "kilogram", short: "kg", kind: "mass", factor: 1000 },
];

const BY_SHORT = new Map(MEASURED.map((m) => [m.short, m]));
const BY_ID = new Map(MEASURED.map((m) => [m.id, m]));

/** Spellings people type that parse-ingredient's table does not cover. */
const ALIASES: Record<string, string> = {
  tsps: "tsp",
  teaspoons: "tsp",
  tbsps: "tbsp",
  tablespoons: "tbsp",
  cups: "cup",
  c: "cup",
  pints: "pt",
  quarts: "qt",
  gallons: "gal",
  ounces: "oz",
  ozs: "oz",
  pounds: "lb",
  lbs: "lb",
  grams: "g",
  kilograms: "kg",
  kgs: "kg",
  milliliters: "ml",
  millilitres: "ml",
  liters: "l",
  litres: "l",
  "fl. oz": "fl oz",
  floz: "fl oz",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
};

/** Countable / container units (singular canonical form). They only combine with themselves. */
export const NAMED_UNITS = [
  "bag",
  "bottle",
  "box",
  "bulb",
  "bunch",
  "can",
  "carton",
  "clove",
  "container",
  "cube",
  "dash",
  "dozen",
  "ear",
  "fillet",
  "handful",
  "head",
  "jar",
  "loaf",
  "pack",
  "package",
  "piece",
  "pinch",
  "rib",
  "sheet",
  "slice",
  "splash",
  "sprig",
  "stalk",
  "stick",
  "strip",
] as const;

const NAMED_PLURALS: Record<string, string> = {
  bunches: "bunch",
  boxes: "box",
  dashes: "dash",
  pinches: "pinch",
  loaves: "loaf",
  packages: "package",
  pkg: "package",
  pkgs: "package",
  pcs: "piece",
  pc: "piece",
  dz: "dozen",
  filet: "fillet",
  filets: "fillet",
};

const NAMED = new Set<string>(NAMED_UNITS);

/** Normalizes a unit string to its canonical stored form, or null when it is not a real unit. */
export function canonicalUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!text) return null;
  if (BY_SHORT.has(text)) return text;
  if (BY_ID.has(text)) return BY_ID.get(text)!.short;
  if (ALIASES[text]) return ALIASES[text]!;
  const named = NAMED_PLURALS[text] ?? (text.endsWith("s") ? text.slice(0, -1) : text);
  if (NAMED.has(named)) return named;
  // A sized container such as "14-oz can" — keep as written, lowercased.
  if (
    /^\d+(?:\.\d+)?-(?:oz|fl oz|g|kg|lb|ml|l) (?:can|jar|bottle|bag|box|package|carton|container)s?$/.test(
      text,
    )
  ) {
    return text.replace(/s$/, "");
  }
  return null;
}

export function unitKind(unit: string | null | undefined): UnitKind {
  if (!unit) return "each";
  const measured = BY_SHORT.get(unit);
  return measured ? measured.kind : "named";
}

/** The part of a merge key that says which amounts may be combined. */
export function unitKey(unit: string | null | undefined): string {
  const kind = unitKind(unit);
  if (kind === "each") return "each";
  if (kind === "volume") return "vol";
  if (kind === "mass") return "wt";
  return `u:${unit}`;
}

export function toBase(quantity: number, unit: string | null | undefined): number {
  const measured = unit ? BY_SHORT.get(unit) : undefined;
  return measured ? quantity * measured.factor : quantity;
}

export function fromBase(base: number, unit: string): number {
  const measured = BY_SHORT.get(unit);
  return measured ? base / measured.factor : base;
}

/** True when a and b can be added or subtracted (same unit, or same measured family). */
export function compatibleUnits(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return unitKey(a) === unitKey(b);
}

const VOLUME_LADDER = ["tsp", "tbsp", "cup"]; // what cooks measure by in the US
const MASS_LADDER_US = ["oz", "lb"];
const MASS_LADDER_METRIC = ["g", "kg"];

/**
 * Nearest "kitchen friendly" value, or null. Precision shrinks as amounts grow: eighths only
 * below 2, thirds and quarters below 10, halves above — nobody measures 14⅜ of anything.
 */
export function friendly(
  value: number,
  tolerance = 0.03,
  allowEighths = true,
  allowThirds = true,
): number | null {
  const base =
    value >= 10
      ? [1, 2]
      : value >= 2
        ? [1, 2, 3, 4]
        : allowEighths
          ? [1, 2, 3, 4, 8]
          : [1, 2, 3, 4];
  // Thirds read naturally in cups and spoons ("⅓ cup"), not in pounds.
  const denominators = allowThirds ? base : base.filter((d) => d !== 3);
  for (const d of denominators) {
    const nearest = Math.round(value * d) / d;
    if (Math.abs(nearest - value) <= tolerance) return nearest;
  }
  return null;
}

type UnitRule = { min: number; eighths: boolean; thirds?: boolean; max?: number };

/**
 * Smallest amount worth expressing in a unit, whether eighths read naturally in it, and the
 * amount at which a larger unit (when one is available) reads better: nobody measures 30 tbsp
 * or 54 oz — that is 1⅞ cups and 3⅜ lb.
 */
const UNIT_RULES: Record<string, UnitRule> = {
  cup: { min: 0.25, eighths: false },
  lb: { min: 0.25, eighths: false, thirds: false },
  pt: { min: 1, eighths: false },
  qt: { min: 1, eighths: false },
  gal: { min: 1, eighths: false },
  tsp: { min: 0.97, eighths: true, max: 3 },
  tbsp: { min: 0.97, eighths: true, max: 16 },
  oz: { min: 0.97, eighths: true, max: 16 },
  "fl oz": { min: 0.97, eighths: true, max: 8 },
  g: { min: 0.97, eighths: true, max: 1000 },
  ml: { min: 0.97, eighths: true, max: 1000 },
};
const DEFAULT_UNIT_RULE: UnitRule = { min: 0.97, eighths: true };

/**
 * Picks the unit and amount to show for a combined measured total. It only ever uses units the
 * recipes themselves used (plus the tsp → tbsp → cup / oz → lb ladders when those systems are in
 * play) and picks the largest unit that still gives a friendly number: 6 tbsp, not 0.375 cup;
 * 1½ cups, not 24 tbsp. When nothing is friendly it keeps a unit a recipe used.
 */
export function pickMeasured(
  baseTotal: number,
  kind: "volume" | "mass",
  seenUnits: string[],
): { quantity: number; unit: string } {
  const bySize = (a: string, b: string) => BY_SHORT.get(a)!.factor - BY_SHORT.get(b)!.factor;
  const seen = [...new Set(seenUnits)].filter((u) => BY_SHORT.get(u)?.kind === kind).sort(bySize);
  if (seen.length === 0) seen.push(kind === "volume" ? "cup" : "oz");

  const ladder = new Set(seen);
  if (kind === "volume" && seen.some((u) => VOLUME_LADDER.includes(u))) {
    for (const u of VOLUME_LADDER) ladder.add(u);
  }
  if (kind === "mass") {
    if (seen.some((u) => MASS_LADDER_US.includes(u))) for (const u of MASS_LADDER_US) ladder.add(u);
    if (seen.some((u) => MASS_LADDER_METRIC.includes(u)))
      for (const u of MASS_LADDER_METRIC) ladder.add(u);
  }
  const candidates = [...ladder].sort(bySize);

  // Largest unit first: take the first where the amount is big enough and "friendly".
  for (let i = candidates.length - 1; i >= 0; i--) {
    const unit = candidates[i]!;
    const rule = UNIT_RULES[unit] ?? DEFAULT_UNIT_RULE;
    const amount = fromBase(baseTotal, unit);
    // Too big for this unit when a larger one is on the ladder ("30 tbsp" → cups).
    const hasLarger = i < candidates.length - 1;
    if (rule.max !== undefined && amount >= rule.max && hasLarger) continue;
    if (amount >= rule.min) {
      const nice = friendly(amount, 0.03, rule.eighths, rule.thirds ?? true);
      if (nice !== null) return { quantity: nice, unit };
    }
  }

  // Nothing friendly: keep a unit the recipes used — the largest that still reads as ≥ ¼.
  const used = [...seen].reverse().find((u) => fromBase(baseTotal, u) >= 0.25) ?? seen[0]!;
  return { quantity: Math.round(fromBase(baseTotal, used) * 100) / 100, unit: used };
}

const VULGAR: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/** 1.5 → "1½", 0.33 → "⅓", 2 → "2", 2.37 → "2.4". Never invents precision. */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value < 0) return `-${formatQuantity(-value)}`;
  const whole = Math.floor(value + 0.03);
  const rest = value - whole;
  if (Math.abs(rest) < 0.03) return String(whole);
  if (Math.abs(rest - 1) < 0.03) return String(whole + 1);
  const match = VULGAR.find(([v]) => Math.abs(v - rest) < 0.03);
  if (match) return whole > 0 ? `${whole}${match[1]}` : match[1];
  return String(Math.round(value * 10) / 10);
}

/** "cup" + 2 → "cups"; "clove" + 1 → "clove"; "14-oz can" + 2 → "14-oz cans". */
export function unitLabel(
  unit: string | null | undefined,
  quantity: number | null | undefined,
): string {
  if (!unit) return "";
  const plural = quantity !== null && quantity !== undefined && quantity > 1.03;
  if (!plural) return unit;
  if (
    unit === "tsp" ||
    unit === "tbsp" ||
    unit === "oz" ||
    unit === "lb" ||
    unit === "g" ||
    unit === "kg" ||
    unit === "ml" ||
    unit === "l" ||
    unit === "fl oz" ||
    unit === "pt" ||
    unit === "qt" ||
    unit === "gal"
  )
    return unit;
  if (unit === "dozen") return unit;
  if (/(ch|sh|s|x|z)$/.test(unit)) return `${unit}es`;
  if (unit.endsWith("f")) return `${unit.slice(0, -1)}ves`; // loaf → loaves
  return `${unit}s`;
}
