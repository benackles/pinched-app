import { defineConfig } from "drizzle-kit";

/**
 * Schema as code → SQL migrations that the Supabase CLI applies (`supabase db push`).
 * `generate` needs no database connection. Custom SQL (grants, functions, triggers, storage
 * policies) is added with `drizzle-kit generate --custom --name=<name>`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./supabase/migrations",
  casing: "snake_case",
  migrations: { prefix: "supabase" },
  // anon / authenticated / service_role are managed by Supabase.
  entities: { roles: { provider: "supabase" } },
  strict: true,
  verbose: true,
});
