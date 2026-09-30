/**
 * A PostgREST-compatible request handler over PGlite, so the real supabase-js client (and the
 * app code written against it) runs unchanged in credential-free local mode.
 *
 * It reproduces the parts of PostgREST that matter for correctness: the JWT role switch
 * (`set local role` + `request.jwt.claims`, so RLS applies exactly as in production), JSON
 * serialisation done by Postgres, `Prefer` headers for return/upsert/count, single-object mode,
 * and PostgREST's HTTP status mapping for Postgres errors.
 */
import { parseQuery, PostgrestError, type ParsedQuery } from "./parse";
import {
  buildDelete,
  buildInsert,
  buildRpc,
  buildSelect,
  buildUpdate,
  quote,
  type Built,
  type FunctionMeta,
  type MutationOptions,
  type SchemaMeta,
  type TableMeta,
} from "./sql";

export type Claims = Record<string, unknown>;

type Tx = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
};

/** The slice of PGlite this handler needs. */
export type Queryable = Tx & { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

export type PostgrestContext = {
  db: Queryable;
  /** Verified claims for a bearer token, or null when the token is invalid or expired. */
  verifyToken: (token: string) => Claims | "expired" | null;
};

const ROLES = new Set(["anon", "authenticated", "service_role"]);
const schemaCache = new WeakMap<object, Promise<SchemaMeta>>();

/** Reads table, column, primary-key and function metadata once per database. */
export function loadSchema(db: Queryable): Promise<SchemaMeta> {
  let cached = schemaCache.get(db);
  if (!cached) {
    cached = readSchema(db);
    schemaCache.set(db, cached);
  }
  return cached;
}

/** Call after running migrations on a database that has already served requests. */
export function invalidateSchema(db: Queryable): void {
  schemaCache.delete(db);
}

async function readSchema(db: Queryable): Promise<SchemaMeta> {
  const columns = await db.query<{ table_name: string; column_name: string; udt_name: string }>(`
    select c.table_name, c.column_name, c.udt_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
     order by c.table_name, c.ordinal_position`);
  const keys = await db.query<{ table_name: string; column_name: string }>(`
    select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
     order by tc.table_name, kcu.ordinal_position`);
  const functions = await db.query<{ proname: string; proretset: boolean; rettype: string }>(`
    select p.proname, p.proretset, pg_catalog.format_type(p.prorettype, null) as rettype
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'`);

  const tables = new Map<string, TableMeta>();
  for (const row of columns.rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: new Map(), primaryKey: [] };
      tables.set(row.table_name, table);
    }
    table.columns.set(row.column_name, { type: row.udt_name });
  }
  for (const row of keys.rows) tables.get(row.table_name)?.primaryKey.push(row.column_name);

  const fns = new Map<string, FunctionMeta>();
  for (const row of functions.rows) {
    fns.set(row.proname, { name: row.proname, returnsSet: row.proretset, returnType: row.rettype });
  }
  return { tables, functions: fns };
}

/** PostgREST's mapping from Postgres error classes to HTTP status codes. */
function statusFor(code: string, role: string): number {
  if (code === "42501") return role === "anon" ? 401 : 403;
  if (code === "23503" || code === "23505") return 409;
  if (code === "42883" || code === "42P01") return 404;
  if (code === "P0001") return 400;
  const klass = code.slice(0, 2);
  if (klass === "28" || klass === "0L" || klass === "0P") return 403;
  if (
    ["40", "XX", "58", "57", "55", "25", "2D", "38", "39", "3B", "F0", "HV", "09", "P0"].includes(
      klass,
    )
  )
    return 500;
  if (klass === "53" || klass === "08") return 503;
  return 400;
}

function toPostgrestError(error: unknown, role: string): PostgrestError {
  if (error instanceof PostgrestError) return error;
  const e = error as { code?: string; message?: string; detail?: string; hint?: string };
  const code = e.code ?? "";
  if (!code) return new PostgrestError(500, "PGRST000", e.message ?? String(error));
  return new PostgrestError(
    statusFor(code, role),
    code,
    e.message ?? "",
    e.detail ?? null,
    e.hint ?? null,
  );
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const errorResponse = (error: PostgrestError) => json(error.status, error.toBody());

function parsePrefer(header: string | null) {
  const prefer = new Map<string, string>();
  for (const part of (header ?? "").split(",")) {
    const [key, value] = part.trim().split("=");
    if (key) prefer.set(key, value ?? "");
  }
  return prefer;
}

const SINGLE = "application/vnd.pgrst.object+json";

function requireTable(schema: SchemaMeta, name: string): TableMeta {
  const table = schema.tables.get(name);
  if (!table) {
    throw new PostgrestError(
      404,
      "PGRST205",
      `Could not find the table 'public.${name}' in the schema cache`,
      null,
      "Perhaps you meant a different table name.",
    );
  }
  return table;
}

function authenticate(request: Request, ctx: PostgrestContext): { claims: Claims; role: string } {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { claims: { role: "anon" }, role: "anon" };
  const result = ctx.verifyToken(match[1]!);
  if (result === "expired") throw new PostgrestError(401, "PGRST303", "JWT expired");
  if (!result) throw new PostgrestError(401, "PGRST301", "JWSError JWSInvalidSignature");
  const role = typeof result.role === "string" ? result.role : "";
  if (!ROLES.has(role)) {
    throw new PostgrestError(403, "42704", `role "${role}" does not exist`);
  }
  return { claims: result, role };
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new PostgrestError(400, "PGRST102", "Empty or invalid json");
  }
}

function contentRange(offset: number, length: number, total: number | null) {
  const range = length === 0 ? "*" : `${offset}-${offset + length - 1}`;
  return `${range}/${total === null ? "*" : total}`;
}

export async function handlePostgrest(request: Request, ctx: PostgrestContext): Promise<Response> {
  let role = "anon";
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/rest\/v1\/?/, "");
    if (!path) throw new PostgrestError(404, "PGRST125", "Invalid path specified in request URL");

    const auth = authenticate(request, ctx);
    role = auth.role;
    const schema = await loadSchema(ctx.db);
    const method = request.method.toUpperCase();
    const prefer = parsePrefer(request.headers.get("prefer"));
    const single = (request.headers.get("accept") ?? "").includes(SINGLE);

    // ───────── RPC
    if (path.startsWith("rpc/")) {
      if (method !== "POST")
        throw new PostgrestError(405, "PGRST101", "Only POST is supported for rpc");
      const name = path.slice(4);
      const fn = schema.functions.get(name);
      if (!fn) {
        throw new PostgrestError(
          404,
          "PGRST202",
          `Could not find the function public.${name} in the schema cache`,
        );
      }
      const args = ((await readBody(request)) ?? {}) as Record<string, unknown>;
      const built = buildRpc(fn, args);
      const rows = await run(
        ctx.db,
        auth,
        async (tx) => (await tx.query<{ body?: string }>(built.sql, built.params)).rows,
      );
      if (fn.returnType === "void") return new Response(null, { status: 204 });
      const body = rows[0]?.body;
      return new Response(body ?? "null", {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // ───────── tables
    const table = requireTable(schema, path);
    const query = parseQuery(url.searchParams);
    if (prefer.get("missing") === "default") {
      throw new PostgrestError(
        400,
        "PGRST100",
        "Prefer: missing=default is not supported by the local backend",
        null,
        "Give every row of a bulk insert the same keys.",
      );
    }
    const returning = prefer.get("return") === "representation";
    const options: MutationOptions = {
      returning,
      resolution:
        prefer.get("resolution") === "merge-duplicates"
          ? "merge-duplicates"
          : prefer.get("resolution") === "ignore-duplicates"
            ? "ignore-duplicates"
            : null,
    };

    if (method === "GET" || method === "HEAD") {
      const built = buildSelect(table, query);
      const wantCount = Boolean(prefer.get("count"));
      const { body, total } = await run(ctx.db, auth, async (tx) => {
        const rows =
          method === "HEAD"
            ? "[]"
            : ((await tx.query<{ body: string }>(built.rows.sql, built.rows.params)).rows[0]
                ?.body ?? "[]");
        const count = wantCount
          ? ((await tx.query<{ total: number }>(built.count.sql, built.count.params)).rows[0]
              ?.total ?? 0)
          : null;
        return { body: rows, total: count };
      });
      const rows = JSON.parse(body) as unknown[];
      const range = contentRange(query.offset ?? 0, method === "HEAD" ? 0 : rows.length, total);
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Content-Range": range } });
      }
      if (single) return singleResponse(rows, 200, range);
      return json(200, rows, { "Content-Range": range });
    }

    if (method === "POST") {
      const payload = await readBody(request);
      if (payload === null || typeof payload !== "object") {
        throw new PostgrestError(400, "PGRST102", "Empty or invalid json");
      }
      const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
      const built = buildInsert(table, rows, query, options);
      return await mutate(ctx.db, auth, built, options, single, 201);
    }

    if (method === "PATCH") {
      const payload = await readBody(request);
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new PostgrestError(400, "PGRST102", "Empty or invalid json");
      }
      const built = buildUpdate(table, payload as Record<string, unknown>, query, options);
      return await mutate(ctx.db, auth, built, options, single, 200);
    }

    if (method === "DELETE") {
      const built = buildDelete(table, query, options);
      return await mutate(ctx.db, auth, built, options, single, 200);
    }

    throw new PostgrestError(405, "PGRST117", `Unsupported HTTP method: ${method}`);
  } catch (error) {
    return errorResponse(toPostgrestError(error, role));
  }
}

function singleResponse(rows: unknown[], status: number, range?: string) {
  if (rows.length !== 1) {
    throw new PostgrestError(
      406,
      "PGRST116",
      "JSON object requested, multiple (or no) rows returned",
      `The result contains ${rows.length} rows`,
    );
  }
  return new Response(JSON.stringify(rows[0]), {
    status,
    headers: {
      "Content-Type": `${SINGLE}; charset=utf-8`,
      ...(range ? { "Content-Range": range } : {}),
    },
  });
}

async function mutate(
  db: Queryable,
  auth: { claims: Claims; role: string },
  built: Built,
  options: MutationOptions,
  single: boolean,
  okStatus: number,
): Promise<Response> {
  const result = await run(db, auth, async (tx) => {
    const { rows } = await tx.query<{ body?: string }>(built.sql, built.params);
    if (!options.returning) return null;
    const list = JSON.parse(rows[0]?.body ?? "[]") as unknown[];
    // PostgREST rolls the statement back when a single object was demanded but not produced.
    if (single && list.length !== 1) singleResponse(list, okStatus);
    return list;
  });
  if (result === null) return new Response(null, { status: okStatus === 201 ? 201 : 204 });
  if (single) return singleResponse(result, okStatus);
  return json(okStatus, result, { "Content-Range": contentRange(0, result.length, null) });
}

/** One request = one transaction running as the JWT's role, like PostgREST. */
function run<T>(
  db: Queryable,
  auth: { claims: Claims; role: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(auth.claims),
    ]);
    await tx.exec(`set local role ${quote(auth.role)}`);
    return fn(tx);
  });
}

export type { ParsedQuery };
