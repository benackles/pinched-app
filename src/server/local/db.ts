import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { SUPABASE_SHIM_SQL } from "@/db/bootstrap";
import { applyMigrations } from "@/db/migrations";
import { loadCatalog } from "@/lib/catalog/load";

import { invalidateSchema, type Queryable } from "./postgrest/handler";
import { localDataRoot } from "./secret";

type LocalDb = Queryable & {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
};

const GLOBAL_KEY = "__pinchedLocalDb";
type Holder = { [GLOBAL_KEY]?: Promise<LocalDb> };

/**
 * The credential-free local database: real Postgres (PGlite) running the real migrations and the
 * seeded catalog, persisted under .pinched-local/. One instance per process, shared across
 * hot reloads. `PINCHED_LOCAL_DB=memory` keeps everything in memory (tests, e2e).
 */
export function getLocalDb(): Promise<LocalDb> {
  const holder = globalThis as unknown as Holder;
  holder[GLOBAL_KEY] ??= open();
  return holder[GLOBAL_KEY];
}

async function open(): Promise<LocalDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  let db: InstanceType<typeof PGlite>;
  if (process.env.PINCHED_LOCAL_DB === "memory") {
    db = new PGlite();
  } else {
    const dir = path.join(localDataRoot(), "pgdata");
    fs.mkdirSync(dir, { recursive: true });
    db = new PGlite(dir);
  }
  await db.waitReady;

  await db.exec(SUPABASE_SHIM_SQL);
  await applyMigrations(db);
  await seedCatalog(db);
  invalidateSchema(db as unknown as Queryable);
  return db as unknown as LocalDb;
}

/** Loads the starter catalog (all of it published — this is a demo database) when it changes. */
async function seedCatalog(db: {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}) {
  const { sql } = loadCatalog({ publishAll: true });
  const hash = createHash("sha256").update(sql).digest("hex");
  await db.exec(
    `create table if not exists pinched_local.meta (key text primary key, value text not null)`,
  );
  const { rows } = await db.query<{ value: string }>(
    `select value from pinched_local.meta where key = 'catalog_hash'`,
  );
  if (rows[0]?.value === hash) return;
  await db.exec(sql);
  await db.query(
    `insert into pinched_local.meta (key, value) values ('catalog_hash', $1)
     on conflict (key) do update set value = excluded.value`,
    [hash],
  );
}
