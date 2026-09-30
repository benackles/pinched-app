/**
 * PostgREST request grammar → a small structured query. Pure (no database), so it is unit-tested
 * on its own. Only the subset supabase-js produces for Pinched's flat queries is supported;
 * anything else is rejected with a PostgREST-shaped error rather than half-working.
 *
 * Not supported on purpose: resource embedding (`rel(*)`), full-text search, JSON path operators.
 * The app reads related rows with separate flat queries (composite foreign keys would make
 * embedding ambiguous in real PostgREST anyway).
 */

export class PostgrestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string | null = null,
    public hint: string | null = null,
  ) {
    super(message);
  }

  toBody() {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

export const FILTER_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "cs",
  "cd",
  "ov",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type Condition = { column: string; op: FilterOp; value: string; negate: boolean };
export type FilterNode =
  | { kind: "condition"; condition: Condition }
  | { kind: "group"; logic: "and" | "or"; negate: boolean; children: FilterNode[] };

export type SelectColumn = { column: string; alias: string | null } | { star: true };
export type OrderTerm = {
  column: string;
  direction: "asc" | "desc";
  nulls: "first" | "last" | null;
};

export type ParsedQuery = {
  select: SelectColumn[];
  filters: FilterNode[];
  order: OrderTerm[];
  limit: number | null;
  offset: number | null;
  onConflict: string[] | null;
  columns: string[] | null;
};

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const bad = (message: string, details: string | null = null) =>
  new PostgrestError(400, "PGRST100", message, details);

/** Splits on commas that are not inside parentheses or double quotes. */
export function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      current += ch;
      if (ch === "\\" && i + 1 < input.length) current += input[++i]!;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      current += ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (quoted || depth !== 0) throw bad("unbalanced quotes or parentheses", input);
  if (current !== "" || parts.length) parts.push(current);
  return parts;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return value;
}

function parseSelect(raw: string | null): SelectColumn[] {
  if (raw === null || raw.trim() === "") return [{ star: true }];
  if (raw.includes("(")) {
    throw bad(
      "Resource embedding is not supported by the local backend",
      "Use separate flat queries.",
    );
  }
  return splitTopLevel(raw).map((term): SelectColumn => {
    const trimmed = term.trim();
    if (trimmed === "*") return { star: true };
    const [left, right] = trimmed.split(":");
    if (right !== undefined) {
      if (!IDENT.test(left!) || !IDENT.test(right)) throw bad(`invalid select term "${trimmed}"`);
      return { column: right, alias: left! };
    }
    if (!IDENT.test(trimmed)) throw bad(`invalid select term "${trimmed}"`);
    return { column: trimmed, alias: null };
  });
}

function parseOrder(raw: string | null): OrderTerm[] {
  if (!raw) return [];
  return splitTopLevel(raw).map((term) => {
    const [column, ...flags] = term.trim().split(".");
    if (!column || !IDENT.test(column)) throw bad(`invalid order term "${term}"`);
    let direction: "asc" | "desc" = "asc";
    let nulls: "first" | "last" | null = null;
    for (const flag of flags) {
      if (flag === "asc" || flag === "desc") direction = flag;
      else if (flag === "nullsfirst") nulls = "first";
      else if (flag === "nullslast") nulls = "last";
      else throw bad(`invalid order modifier "${flag}"`);
    }
    return { column, direction, nulls };
  });
}

function parseCondition(column: string, expr: string): Condition {
  if (!IDENT.test(column)) throw bad(`invalid column "${column}"`);
  let rest = expr;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot === -1) throw bad(`invalid filter "${column}=${expr}"`);
  const op = rest.slice(0, dot) as FilterOp;
  if (!(FILTER_OPS as readonly string[]).includes(op)) {
    throw bad(`unsupported operator "${op}"`, `Supported: ${FILTER_OPS.join(", ")}`);
  }
  // Inside or(…)/and(…), values containing commas or parentheses arrive double-quoted.
  const raw = rest.slice(dot + 1);
  return { column, op, value: op === "in" ? raw : unquote(raw), negate };
}

/** Parses the inside of `or=(…)` / `and=(…)`, including nested `and(…)` / `or(…)` / `not.and(…)`. */
function parseGroupBody(body: string): FilterNode[] {
  return splitTopLevel(body).map((item): FilterNode => {
    const group = /^(not\.)?(and|or)\((.*)\)$/s.exec(item.trim());
    if (group) {
      return {
        kind: "group",
        logic: group[2] as "and" | "or",
        negate: Boolean(group[1]),
        children: parseGroupBody(group[3]!),
      };
    }
    const firstDot = item.indexOf(".");
    if (firstDot === -1) throw bad(`invalid logic tree item "${item}"`);
    return {
      kind: "condition",
      condition: parseCondition(item.slice(0, firstDot), item.slice(firstDot + 1)),
    };
  });
}

function parseGroupParam(key: string, value: string): FilterNode {
  const match = /^(not\.)?(and|or)$/.exec(key)!;
  if (!value.startsWith("(") || !value.endsWith(")")) throw bad(`invalid ${key} value`, value);
  return {
    kind: "group",
    logic: match[2] as "and" | "or",
    negate: Boolean(match[1]),
    children: parseGroupBody(value.slice(1, -1)),
  };
}

const toCount = (name: string, raw: string | null): number | null => {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw bad(`${name} must be a non-negative integer`);
  return Number(raw);
};

export function parseQuery(params: URLSearchParams): ParsedQuery {
  const filters: FilterNode[] = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "and" || key === "or" || key === "not.and" || key === "not.or") {
      filters.push(parseGroupParam(key, value));
    } else {
      filters.push({ kind: "condition", condition: parseCondition(key, value) });
    }
  }
  const onConflict = params.get("on_conflict");
  const columns = params.get("columns");
  return {
    select: parseSelect(params.get("select")),
    filters,
    order: parseOrder(params.get("order")),
    limit: toCount("limit", params.get("limit")),
    offset: toCount("offset", params.get("offset")),
    onConflict: onConflict ? onConflict.split(",").map((c) => unquote(c.trim())) : null,
    columns: columns ? splitTopLevel(columns).map((c) => unquote(c.trim())) : null,
  };
}

/** Values of an `in.(a,b,"c d")` filter. */
export function parseInList(value: string): string[] {
  if (!value.startsWith("(") || !value.endsWith(")")) throw bad(`invalid in list "${value}"`);
  const inner = value.slice(1, -1);
  if (inner.trim() === "") return [];
  return splitTopLevel(inner).map((v) => unquote(v.trim()));
}
