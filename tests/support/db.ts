import { PGlite } from "@electric-sql/pglite";

import { SUPABASE_SHIM_SQL } from "@/db/bootstrap";
import { applyMigrations } from "@/db/migrations";

export type Db = PGlite;

/** A fresh in-memory Postgres with the Supabase shims and every real migration applied. */
export async function createTestDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM_SQL);
  await applyMigrations(db);
  return db;
}

type Claims = Record<string, unknown>;

/**
 * Runs `fn` the way PostgREST would: one transaction, `SET LOCAL ROLE`, and the verified
 * token claims exposed through `request.jwt.claims` (so `auth.jwt()` works in policies).
 * A thrown error rolls the transaction back, exactly like a failed REST request.
 */
export async function withRole<T>(
  db: Db,
  role: "anon" | "authenticated" | "service_role",
  claims: Claims,
  fn: (tx: { query: Db["query"]; exec: Db["exec"] }) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${role}`);
    return fn(tx as unknown as { query: Db["query"]; exec: Db["exec"] });
  });
}

/** A signed-in Clerk user (role + sub claims, as Clerk's session token carries). */
export function asUser<T>(db: Db, userId: string, fn: Parameters<typeof withRole<T>>[3]) {
  return withRole(db, "authenticated", { sub: userId, role: "authenticated" }, fn);
}

export function asService<T>(db: Db, fn: Parameters<typeof withRole<T>>[3]) {
  return withRole(db, "service_role", { role: "service_role" }, fn);
}

export function asAnon<T>(db: Db, fn: Parameters<typeof withRole<T>>[3]) {
  return withRole(db, "anon", { role: "anon" }, fn);
}

/** Runs `fn` and returns the Postgres error it raised (code + message), or null if it succeeded. */
export async function pgError(fn: () => Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code, message: e.message ?? String(error) };
  }
}
