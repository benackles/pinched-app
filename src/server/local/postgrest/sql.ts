/**
 * Structured PostgREST query → SQL + parameters. Identifiers are only ever taken from the
 * introspected schema (never interpolated from the URL), and every value is a bound parameter.
 */
import {
  parseInList,
  PostgrestError,
  type Condition,
  type FilterNode,
  type ParsedQuery,
  type SelectColumn,
} from "./parse";

export type ColumnMeta = { type: string };
export type TableMeta = { name: string; columns: Map<string, ColumnMeta>; primaryKey: string[] };
export type FunctionMeta = { name: string; returnsSet: boolean; returnType: string };
export type SchemaMeta = { tables: Map<string, TableMeta>; functions: Map<string, FunctionMeta> };

export type Built = { sql: string; params: unknown[] };

export const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function requireColumn(meta: TableMeta, column: string): void {
  if (!meta.columns.has(column)) {
    throw new PostgrestError(400, "42703", `column ${meta.name}.${column} does not exist`);
  }
}

function compileCondition(c: Condition, meta: TableMeta, params: Params): string {
  requireColumn(meta, c.column);
  const col = quote(c.column);
  let sql: string;
  switch (c.op) {
    case "eq":
      sql = `${col} = ${params.add(c.value)}`;
      break;
    case "neq":
      sql = `${col} <> ${params.add(c.value)}`;
      break;
    case "gt":
      sql = `${col} > ${params.add(c.value)}`;
      break;
    case "gte":
      sql = `${col} >= ${params.add(c.value)}`;
      break;
    case "lt":
      sql = `${col} < ${params.add(c.value)}`;
      break;
    case "lte":
      sql = `${col} <= ${params.add(c.value)}`;
      break;
    case "like":
      sql = `${col} like ${params.add(c.value.replace(/\*/g, "%"))}`;
      break;
    case "ilike":
      sql = `${col} ilike ${params.add(c.value.replace(/\*/g, "%"))}`;
      break;
    case "is": {
      const v = c.value.toLowerCase();
      if (!["null", "true", "false", "unknown"].includes(v)) {
        throw new PostgrestError(400, "PGRST100", `invalid value for is: ${c.value}`);
      }
      sql = `${col} is ${v}`;
      break;
    }
    case "in": {
      const list = parseInList(c.value);
      sql = list.length ? `${col} in (${list.map((v) => params.add(v)).join(", ")})` : "false";
      break;
    }
    case "cs":
      sql = `${col} @> ${params.add(c.value)}`;
      break;
    case "cd":
      sql = `${col} <@ ${params.add(c.value)}`;
      break;
    case "ov":
      sql = `${col} && ${params.add(c.value)}`;
      break;
  }
  return c.negate ? `not (${sql})` : sql;
}

function compileNode(node: FilterNode, meta: TableMeta, params: Params): string {
  if (node.kind === "condition") return compileCondition(node.condition, meta, params);
  if (node.children.length === 0) return node.negate ? "true" : "false";
  const inner = node.children
    .map((child) => compileNode(child, meta, params))
    .join(node.logic === "and" ? " and " : " or ");
  return node.negate ? `not (${inner})` : `(${inner})`;
}

function where(filters: FilterNode[], meta: TableMeta, params: Params): string {
  if (filters.length === 0) return "";
  return ` where ${filters.map((f) => `(${compileNode(f, meta, params)})`).join(" and ")}`;
}

function selectList(select: SelectColumn[], meta: TableMeta): string {
  return select
    .map((term) => {
      if ("star" in term) return "*";
      requireColumn(meta, term.column);
      return term.alias && term.alias !== term.column
        ? `${quote(term.column)} as ${quote(term.alias)}`
        : quote(term.column);
    })
    .join(", ");
}

function orderBy(query: ParsedQuery, meta: TableMeta): string {
  if (query.order.length === 0) return "";
  const terms = query.order.map((t) => {
    requireColumn(meta, t.column);
    const nulls = t.nulls ? ` nulls ${t.nulls}` : "";
    return `${quote(t.column)} ${t.direction}${nulls}`;
  });
  return ` order by ${terms.join(", ")}`;
}

/** Wraps a row-producing query so the database serialises it as JSON — exactly how PostgREST does. */
const jsonAgg = (inner: string) =>
  `select coalesce(json_agg(pgrst_body), '[]')::text as body from (${inner}) pgrst_body`;

export function buildSelect(table: TableMeta, query: ParsedQuery): { rows: Built; count: Built } {
  const params = new Params();
  const cond = where(query.filters, table, params);
  const order = orderBy(query, table);
  const limit = query.limit !== null ? ` limit ${query.limit}` : "";
  const offset = query.offset ? ` offset ${query.offset}` : "";
  const inner = `select ${selectList(query.select, table)} from public.${quote(table.name)}${cond}${order}${limit}${offset}`;

  const countParams = new Params();
  const countCond = where(query.filters, table, countParams);
  return {
    rows: { sql: jsonAgg(inner), params: params.values },
    count: {
      sql: `select count(*)::int as total from public.${quote(table.name)}${countCond}`,
      params: countParams.values,
    },
  };
}

function insertColumns(table: TableMeta, rows: Record<string, unknown>[], query: ParsedQuery) {
  const names = query.columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  for (const name of names) {
    if (!table.columns.has(name)) {
      throw new PostgrestError(
        400,
        "PGRST204",
        `Could not find the '${name}' column of '${table.name}' in the schema cache`,
      );
    }
  }
  return names;
}

export type MutationOptions = {
  returning: boolean;
  resolution: "merge-duplicates" | "ignore-duplicates" | null;
};

export function buildInsert(
  table: TableMeta,
  body: Record<string, unknown>[],
  query: ParsedQuery,
  options: MutationOptions,
): Built {
  const params = new Params();
  const columns = insertColumns(table, body, query);
  const target = `public.${quote(table.name)}`;

  let statement: string;
  if (columns.length === 0) {
    statement = `insert into ${target} default values`;
  } else {
    const list = columns.map(quote).join(", ");
    const payload = params.add(JSON.stringify(body));
    statement = `insert into ${target} (${list}) select ${list} from json_populate_recordset(null::${target}, ${payload}::json)`;
  }

  if (options.resolution) {
    const conflict = query.onConflict ?? table.primaryKey;
    if (conflict.length === 0) {
      throw new PostgrestError(400, "PGRST100", "upsert needs on_conflict or a primary key");
    }
    for (const c of conflict) {
      if (!table.columns.has(c))
        throw new PostgrestError(400, "42703", `column ${c} does not exist`);
    }
    const target2 = `(${conflict.map(quote).join(", ")})`;
    if (options.resolution === "ignore-duplicates" || columns.length === 0) {
      statement += ` on conflict ${target2} do nothing`;
    } else {
      const sets = columns.map((c) => `${quote(c)} = excluded.${quote(c)}`).join(", ");
      statement += ` on conflict ${target2} do update set ${sets}`;
    }
  }
  return finishMutation(statement, table, query, options, params);
}

export function buildUpdate(
  table: TableMeta,
  body: Record<string, unknown>,
  query: ParsedQuery,
  options: MutationOptions,
): Built {
  const params = new Params();
  const columns = Object.keys(body);
  if (columns.length === 0) {
    throw new PostgrestError(400, "PGRST102", "Empty or invalid json");
  }
  for (const c of columns) {
    if (!table.columns.has(c)) {
      throw new PostgrestError(
        400,
        "PGRST204",
        `Could not find the '${c}' column of '${table.name}' in the schema cache`,
      );
    }
  }
  const target = `public.${quote(table.name)}`;
  const list = columns.map(quote).join(", ");
  const payload = params.add(JSON.stringify(body));
  const cond = where(query.filters, table, params);
  const statement = `update ${target} set (${list}) = (select ${list} from json_populate_record(null::${target}, ${payload}::json))${cond}`;
  return finishMutation(statement, table, query, options, params);
}

export function buildDelete(table: TableMeta, query: ParsedQuery, options: MutationOptions): Built {
  const params = new Params();
  const cond = where(query.filters, table, params);
  const statement = `delete from public.${quote(table.name)}${cond}`;
  return finishMutation(statement, table, query, options, params);
}

function finishMutation(
  statement: string,
  table: TableMeta,
  query: ParsedQuery,
  options: MutationOptions,
  params: Params,
): Built {
  if (!options.returning) return { sql: statement, params: params.values };
  const projection = selectList(query.select, table);
  const order = orderBy(query, table);
  return {
    sql: `with pgrst_source as (${statement} returning *) ${jsonAgg(`select ${projection} from pgrst_source${order}`)}`,
    params: params.values,
  };
}

const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function buildRpc(fn: FunctionMeta, args: Record<string, unknown>): Built {
  const params = new Params();
  const named = Object.entries(args).map(([key, value]) => {
    if (!FUNCTION_NAME.test(key))
      throw new PostgrestError(400, "PGRST100", `invalid argument "${key}"`);
    const bound =
      value === null || value === undefined
        ? null
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    return `${quote(key)} := ${params.add(bound)}`;
  });
  const call = `public.${quote(fn.name)}(${named.join(", ")})`;
  if (fn.returnType === "void") return { sql: `select ${call}`, params: params.values };
  if (fn.returnsSet) {
    return {
      sql: `select coalesce(json_agg(pgrst_body), '[]')::text as body from ${call} pgrst_body`,
      params: params.values,
    };
  }
  return { sql: `select to_json(${call})::text as body`, params: params.values };
}
