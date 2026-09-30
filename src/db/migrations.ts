import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type MigrationFile = { name: string; sql: string };

/** Anything that can run a multi-statement SQL script (PGlite, a pg client wrapper, …). */
export type SqlExecutor = { exec(sql: string): Promise<unknown> };

export function migrationsDir(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), "supabase", "migrations");
}

/** The Supabase migrations in apply order (timestamp-prefixed file names sort chronologically). */
export function readMigrationFiles(dir: string = migrationsDir()): MigrationFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ name: file, sql: readFileSync(path.join(dir, file), "utf8") }));
}

/** Applies every migration that has not run yet; returns the names it applied. */
export async function applyMigrations(
  db: SqlExecutor & {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  },
  files: MigrationFile[] = readMigrationFiles(),
): Promise<string[]> {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS pinched_local;
    CREATE TABLE IF NOT EXISTS pinched_local.migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());
  `);
  const { rows } = await db.query<{ name: string }>("SELECT name FROM pinched_local.migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file.name)) continue;
    await db.exec(file.sql);
    await db.query("INSERT INTO pinched_local.migrations (name) VALUES ($1)", [file.name]);
    applied.push(file.name);
  }
  return applied;
}
