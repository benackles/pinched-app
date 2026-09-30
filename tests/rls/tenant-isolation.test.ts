/**
 * Cross-user isolation. The PRD names "Clerk + Supabase RLS misconfiguration leaks data" as its
 * highest-impact risk, so every user-owned table is exercised as two different signed-in users
 * and as an anonymous caller: reads, tampering, ownership hijacks, spoofed inserts and
 * cross-tenant foreign keys.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asAnon, asService, asUser, createTestDb, pgError, type Db } from "../support/db";
import { ALICE, BOB, ids, seedTwoTenants, TENANT_TABLES } from "../support/fixtures";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await seedTwoTenants(db);
  // A second, empty plan for Bob so unique constraints cannot mask foreign-key errors below.
  await asService(db, async (tx) => {
    await tx.exec(`insert into weekly_plans (id, user_id, week_start_date)
      values ('00000000-0000-4000-8000-000000000099', '${BOB}', '2026-10-05')`);
  });
});
afterAll(async () => {
  await db.close();
});

const BOB_PLAN_2 = "00000000-0000-4000-8000-000000000099";

/** A stable fingerprint of one tenant's rows in a table, to prove nothing changed. */
async function fingerprint(table: string, userId: string): Promise<string> {
  const { rows } = await asService(db, (tx) =>
    tx.query<{ fp: string | null }>(
      `select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) as fp
       from ${table} t where user_id = $1`,
      [userId],
    ),
  );
  return rows[0]!.fp ?? "";
}

describe("RLS coverage", () => {
  it("is enabled on every table in the public schema", async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      and c.relname <> 'migrations'`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("every user-keyed table has at least one policy (push_deliveries is service-only)", async () => {
    const { rows } = await db.query<{ table_name: string }>(`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name)`);
    expect(rows.map((r) => r.table_name)).toEqual(["push_deliveries"]);
  });

  it("covers every table that has a user_id column", async () => {
    const { rows } = await db.query<{ table_name: string }>(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'`);
    const covered = new Set(TENANT_TABLES.map((t) => t.table));
    const missing = rows
      .map((r) => r.table_name)
      .filter((t) => !covered.has(t) && t !== "push_deliveries");
    expect(missing).toEqual([]);
  });

  it("security-definer functions pin their search_path", async () => {
    const { rows } = await db.query<{ proname: string; proconfig: string[] | null }>(`
      select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef`);
    expect(rows.length).toBeGreaterThan(0);
    for (const fn of rows) {
      expect(
        fn.proconfig?.some((c) => c.startsWith("search_path=")),
        fn.proname,
      ).toBe(true);
    }
  });
});

describe.each(TENANT_TABLES)("$table", ({ table, touch }) => {
  it("shows each signed-in user only their own rows (and is never empty)", async () => {
    for (const user of [ALICE, BOB]) {
      const rows = await asUser(
        db,
        user,
        async (tx) => (await tx.query<{ user_id: string }>(`select user_id from ${table}`)).rows,
      );
      expect(rows.length, `${user} should see own rows in ${table}`).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([user]));
    }
  });

  it("denies anonymous callers entirely", async () => {
    const error = await pgError(() => asAnon(db, (tx) => tx.query(`select * from ${table}`)));
    expect(error?.code).toBe("42501");
  });

  it("cannot update another user's rows", async () => {
    const before = await fingerprint(table, BOB);
    const result = await asUser(db, ALICE, (tx) =>
      tx.query(`update ${table} set ${touch} where user_id = '${BOB}' returning 1`),
    ).catch((e: { code?: string }) => e);
    const denied = "code" in result && result.code === "42501";
    const affected = "rows" in result ? result.rows.length : 0;
    expect(denied || affected === 0).toBe(true);
    expect(await fingerprint(table, BOB)).toBe(before);
  });

  it("cannot delete another user's rows", async () => {
    const before = await fingerprint(table, BOB);
    const result = await asUser(db, ALICE, (tx) =>
      tx.query(`delete from ${table} where user_id = '${BOB}' returning 1`),
    ).catch((e: { code?: string }) => e);
    const denied = "code" in result && result.code === "42501";
    const affected = "rows" in result ? result.rows.length : 0;
    expect(denied || affected === 0).toBe(true);
    expect(await fingerprint(table, BOB)).toBe(before);
  });

  it("cannot hand its own rows to another user", async () => {
    const before = await fingerprint(table, BOB);
    const result = await asUser(db, ALICE, (tx) =>
      tx.query(`update ${table} set user_id = '${BOB}' where user_id = '${ALICE}' returning 1`),
    ).catch((e: { code?: string }) => e);
    const blocked = "code" in result && typeof result.code === "string";
    const affected = "rows" in result ? result.rows.length : 0;
    expect(blocked || affected === 0).toBe(true);
    expect(await fingerprint(table, BOB)).toBe(before);
  });
});

/** Minimal valid rows addressed to Bob — sent by Alice. */
const SPOOFED_INSERTS: Record<string, string> = {
  profiles: `insert into profiles (user_id, email) values ('${BOB}_2', 'x@example.test')`,
  subscriptions: `insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status) values ('${ALICE}', 'sub_self', 'cus_x', 'active')`,
  usage_counters: `insert into usage_counters (user_id, key, count) values ('${ALICE}', 'url_import:2026-10', 0)`,
  saved_recipes: `insert into saved_recipes (user_id, recipe_id) values ('${BOB}', '${ids.seededPublished}')`,
  recipe_modifications: `insert into recipe_modifications (user_id, saved_recipe_id, changes) values ('${BOB}', '${ids.bobSaved}', '{}')`,
  recipe_notes: `insert into recipe_notes (user_id, saved_recipe_id, text) values ('${BOB}', '${ids.bobSaved}', 'x')`,
  recipe_media: `insert into recipe_media (user_id, recipe_id, kind, storage_path) values ('${BOB}', '${ids.seededPublished}', 'photo', '${BOB}/x/y.jpg')`,
  collections: `insert into collections (user_id, name) values ('${BOB}', 'spoof')`,
  collection_items: `insert into collection_items (collection_id, saved_recipe_id, user_id) values ('${ids.bobCollection}', '${ids.bobSaved}', '${BOB}')`,
  kitchen_items: `insert into kitchen_items (user_id, name, normalized_name) values ('${BOB}', 'x', 'x')`,
  weekly_plans: `insert into weekly_plans (user_id, week_start_date) values ('${BOB}', '2026-11-02')`,
  planned_meals: `insert into planned_meals (user_id, weekly_plan_id, saved_recipe_id, planned_date, servings) values ('${BOB}', '${ids.bobPlan}', '${ids.bobSaved}', '2026-09-30', 2)`,
  grocery_lists: `insert into grocery_lists (user_id, weekly_plan_id) values ('${BOB}', '${BOB_PLAN_2}')`,
  grocery_list_items: `insert into grocery_list_items (user_id, grocery_list_id, name, normalized_name) values ('${BOB}', '${ids.bobList}', 'x', 'x')`,
  grocery_item_sources: `insert into grocery_item_sources (user_id, grocery_list_item_id, planned_meal_id) values ('${BOB}', '${ids.bobItem}', '${ids.bobMeal}')`,
  prep_plans: `insert into prep_plans (user_id, weekly_plan_id) values ('${BOB}', '${BOB_PLAN_2}')`,
  prep_tasks: `insert into prep_tasks (user_id, prep_plan_id, title) values ('${BOB}', '${ids.bobPrepPlan}', 'x')`,
  prep_task_meals: `insert into prep_task_meals (prep_task_id, planned_meal_id, user_id) values ('${ids.bobPrepTask}', '${ids.bobMeal}', '${BOB}')`,
  prep_edit_log: `insert into prep_edit_log (user_id, action) values ('${BOB}', 'add')`,
  cooking_events: `insert into cooking_events (user_id, saved_recipe_id, rating) values ('${BOB}', '${ids.bobSaved}', 3)`,
  push_subscriptions: `insert into push_subscriptions (user_id, endpoint, keys) values ('${BOB}', 'https://push.example/spoof', '{"p256dh":"x","auth":"y"}')`,
};

describe("spoofed inserts", () => {
  it("has a spoof case for every tenant table", () => {
    expect(Object.keys(SPOOFED_INSERTS).sort()).toEqual(TENANT_TABLES.map((t) => t.table).sort());
  });

  it.each(Object.entries(SPOOFED_INSERTS))(
    "%s: cannot be created on another user's behalf",
    async (table, statement) => {
      const before = await fingerprint(table, BOB);
      const error = await pgError(() => asUser(db, ALICE, (tx) => tx.query(statement)));
      expect(error, `${table} should reject the insert`).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(await fingerprint(table, BOB)).toBe(before);
    },
  );
});

describe("cross-tenant foreign keys", () => {
  const cases: [string, string][] = [
    [
      "planned_meals → another user's plan",
      `insert into planned_meals (weekly_plan_id, saved_recipe_id, planned_date, servings) values ('${BOB_PLAN_2}', '${ids.aliceSaved}', '2026-10-06', 2)`,
    ],
    [
      "planned_meals → another user's saved recipe",
      `insert into planned_meals (weekly_plan_id, saved_recipe_id, planned_date, servings) values ('${ids.alicePlan}', '${ids.bobSaved}', '2026-09-30', 2)`,
    ],
    [
      "recipe_notes → another user's saved recipe",
      `insert into recipe_notes (saved_recipe_id, text) values ('${ids.bobSaved}', 'x')`,
    ],
    [
      "recipe_modifications → another user's saved recipe",
      `insert into recipe_modifications (saved_recipe_id, changes) values ('${ids.bobSaved}', '{}')`,
    ],
    [
      "collection_items → another user's collection",
      `insert into collection_items (collection_id, saved_recipe_id) values ('${ids.bobCollection}', '${ids.aliceSavedOwn}')`,
    ],
    [
      "grocery_lists → another user's plan",
      `insert into grocery_lists (weekly_plan_id) values ('${BOB_PLAN_2}')`,
    ],
    [
      "grocery_list_items → another user's list",
      `insert into grocery_list_items (grocery_list_id, name, normalized_name) values ('${ids.bobList}', 'x', 'x')`,
    ],
    [
      "grocery_item_sources → another user's item",
      `insert into grocery_item_sources (grocery_list_item_id, planned_meal_id) values ('${ids.bobItem}', '${ids.aliceMeal}')`,
    ],
    [
      "grocery_item_sources → another user's meal",
      `insert into grocery_item_sources (grocery_list_item_id, planned_meal_id) values ('${ids.aliceItem}', '${ids.bobMeal}')`,
    ],
    [
      "prep_plans → another user's plan",
      `insert into prep_plans (weekly_plan_id) values ('${BOB_PLAN_2}')`,
    ],
    [
      "prep_tasks → another user's prep plan",
      `insert into prep_tasks (prep_plan_id, title) values ('${ids.bobPrepPlan}', 'x')`,
    ],
    [
      "prep_task_meals → another user's meal",
      `insert into prep_task_meals (prep_task_id, planned_meal_id) values ('${ids.alicePrepTask}', '${ids.bobMeal}')`,
    ],
    [
      "cooking_events → another user's saved recipe",
      `insert into cooking_events (saved_recipe_id, rating) values ('${ids.bobSaved}', 4)`,
    ],
    [
      "ingredients → another user's recipe",
      `insert into ingredients (recipe_id, name, normalized_name, raw_text) values ('${ids.bobRecipe}', 'x', 'x', 'x')`,
    ],
    [
      "ingredients → a catalog recipe",
      `insert into ingredients (recipe_id, name, normalized_name, raw_text) values ('${ids.seededPublished}', 'x', 'x', 'x')`,
    ],
    [
      "recipe_steps → another user's recipe",
      `insert into recipe_steps (recipe_id, step_number, instruction) values ('${ids.bobRecipe}', 9, 'x')`,
    ],
    [
      "recipe_steps → a catalog recipe",
      `insert into recipe_steps (recipe_id, step_number, instruction) values ('${ids.seededPublished}', 9, 'x')`,
    ],
  ];

  it.each(cases)("%s is rejected even with the caller's own user_id", async (_name, statement) => {
    // user_id is stamped from Alice's JWT, so RLS passes and the composite foreign key must catch it.
    const error = await pgError(() => asUser(db, ALICE, (tx) => tx.query(statement)));
    expect(error, _name).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("accepts the same shapes when everything belongs to the caller", async () => {
    const error = await pgError(() =>
      asUser(db, ALICE, (tx) =>
        tx.query(
          `insert into planned_meals (weekly_plan_id, saved_recipe_id, planned_date, servings)
           values ('${ids.alicePlan}', '${ids.aliceSaved}', '2026-09-30', 2)`,
        ),
      ),
    );
    expect(error).toBeNull();
  });
});
