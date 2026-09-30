/**
 * Rules beyond plain "own rows": catalog visibility, who may write what, billing tamper
 * resistance, free-tier enforcement and storage paths.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FREE_LIMITS } from "@/lib/domain/constants";

import { asAnon, asService, asUser, createTestDb, pgError, type Db } from "../support/db";
import { ALICE, BOB, id, ids, seedTwoTenants } from "../support/fixtures";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
  await seedTwoTenants(db);
});
afterAll(async () => {
  await db.close();
});

const titles = async (user: string) =>
  asUser(db, user, async (tx) => (await tx.query<{ title: string }>("select title from recipes order by title")).rows.map((r) => r.title));

describe("recipes", () => {
  it("shows published catalog recipes plus the caller's own — never drafts or other people's", async () => {
    expect(await titles(ALICE)).toEqual(["Alice private recipe", "Published catalog recipe"]);
    expect(await titles(BOB)).toEqual(["Bob private recipe", "Published catalog recipe"]);
  });

  it("hides catalog recipes from anonymous callers", async () => {
    const error = await pgError(() => asAnon(db, (tx) => tx.query("select * from recipes")));
    expect(error?.code).toBe("42501");
  });

  it("lets a user create manual and imported recipes they own", async () => {
    const error = await pgError(() =>
      asUser(db, ALICE, async (tx) => {
        await tx.query("insert into recipes (source, title) values ('manual', 'Mine')");
        await tx.query("insert into recipes (source, title, source_url) values ('url_import', 'Imported', 'https://example.test/r')");
      }),
    );
    expect(error).toBeNull();
    const row = await asUser(db, ALICE, async (tx) => (await tx.query<{ owner_id: string }>("select owner_id from recipes where title = 'Mine'")).rows[0]);
    expect(row?.owner_id).toBe(ALICE); // stamped from the JWT, never client-supplied
  });

  it("refuses to create catalog (seeded) recipes or recipes owned by someone else", async () => {
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("insert into recipes (source, title, owner_id) values ('seeded', 'Fake', null)"))))?.code).toBe("42501");
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query(`insert into recipes (source, title, owner_id) values ('manual', 'Spoof', '${BOB}')`))))?.code).toBe("42501");
  });

  it("does not let a user edit or delete catalog recipes or other users' recipes", async () => {
    for (const recipe of [ids.seededPublished, ids.bobRecipe]) {
      const updated = await asUser(db, ALICE, (tx) => tx.query(`update recipes set title = 'hacked' where id = '${recipe}' returning id`));
      expect(updated.rows).toHaveLength(0);
      const deleted = await asUser(db, ALICE, (tx) => tx.query(`delete from recipes where id = '${recipe}' returning id`));
      expect(deleted.rows).toHaveLength(0);
    }
    const { rows } = await asService(db, (tx) => tx.query<{ title: string }>(`select title from recipes where id in ('${ids.seededPublished}', '${ids.bobRecipe}') order by title`));
    expect(rows.map((r) => r.title)).toEqual(["Bob private recipe", "Published catalog recipe"]);
  });

  it("does not let a recipe be re-labelled as a catalog recipe", async () => {
    const error = await pgError(() => asUser(db, ALICE, (tx) => tx.query(`update recipes set source = 'seeded', owner_id = null where id = '${ids.aliceRecipe}'`)));
    expect(error?.code).toBe("42501");
  });

  it("reads ingredients and steps for catalog and own recipes only", async () => {
    const rows = await asUser(db, ALICE, async (tx) => (await tx.query<{ name: string }>("select name from ingredients order by name")).rows.map((r) => r.name));
    expect(rows).toEqual(["rice", "yellow onion"]); // no Bob beans
    const steps = await asUser(db, BOB, async (tx) => (await tx.query<{ instruction: string }>("select instruction from recipe_steps order by instruction")).rows.map((r) => r.instruction));
    expect(steps).toEqual(["Dice the onion.", "Heat the beans."]);
  });

  it("protects catalog ingredients from edits", async () => {
    const updated = await asUser(db, ALICE, (tx) => tx.query("update ingredients set name = 'hacked' where owner_id is null returning id"));
    expect(updated.rows).toHaveLength(0);
    const deleted = await asUser(db, ALICE, (tx) => tx.query("delete from recipe_steps where owner_id is null returning id"));
    expect(deleted.rows).toHaveLength(0);
  });

  it("keeps imports private and unique per user and URL", async () => {
    await asUser(db, ALICE, (tx) => tx.query("insert into recipes (source, title, source_url) values ('url_import', 'Soup', 'https://example.test/soup')"));
    const dupe = await pgError(() => asUser(db, ALICE, (tx) => tx.query("insert into recipes (source, title, source_url) values ('url_import', 'Soup again', 'https://example.test/soup')")));
    expect(dupe?.code).toBe("23505");
    // Bob can import the same page independently and never sees Alice's copy.
    await asUser(db, BOB, (tx) => tx.query("insert into recipes (source, title, source_url) values ('url_import', 'Soup', 'https://example.test/soup')"));
    const bobSoups = await asUser(db, BOB, async (tx) => (await tx.query("select id from recipes where source_url = 'https://example.test/soup'")).rows);
    expect(bobSoups).toHaveLength(1);
  });
});

describe("profiles", () => {
  it("lets a user change their own preferences", async () => {
    const { rows } = await asUser(db, ALICE, (tx) => tx.query("update profiles set prep_day = 6, reminder_time = '18:30', timezone = 'America/Denver', name = 'Alice B.' where user_id = 'user_alice' returning prep_day"));
    expect(rows).toHaveLength(1);
  });

  it("blocks writes to billing and identity columns", async () => {
    // Otherwise someone could point their profile at another customer and open THEIR billing portal.
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("update profiles set stripe_customer_id = 'cus_bob' where user_id = 'user_alice'"))))?.code).toBe("42501");
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("update profiles set email = 'x@example.test' where user_id = 'user_alice'"))))?.code).toBe("42501");
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("update profiles set user_id = 'user_carol' where user_id = 'user_alice'"))))?.code).toBe("42501");
    const { rows } = await asService(db, (tx) => tx.query<{ stripe_customer_id: string }>("select stripe_customer_id from profiles where user_id = 'user_alice'"));
    expect(rows[0]!.stripe_customer_id).toBe("cus_alice");
  });

  it("cannot be deleted from the client", async () => {
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("delete from profiles where user_id = 'user_alice'"))))?.code).toBe("42501");
  });

  it("validates the prep day", async () => {
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("update profiles set prep_day = 9 where user_id = 'user_alice'"))))?.code).toBe("23514");
  });

  it("can be created for the signed-in user only, without billing columns", async () => {
    expect((await pgError(() => asUser(db, "user_dave", (tx) => tx.query("insert into profiles (email, name) values ('dave@example.test', 'Dave')")))) ).toBeNull();
    expect((await pgError(() => asUser(db, "user_erin", (tx) => tx.query("insert into profiles (email, stripe_customer_id) values ('erin@example.test', 'cus_free')"))))?.code).toBe("42501");
  });
});

describe("subscriptions and entitlement", () => {
  it("are readable by their owner only and never writable from the client", async () => {
    const own = await asUser(db, ALICE, async (tx) => (await tx.query<{ status: string }>("select status from subscriptions")).rows);
    expect(own).toEqual([{ status: "active" }]);
    for (const statement of [
      "update subscriptions set status = 'active' where user_id = 'user_bob'",
      "update subscriptions set plan = 'yearly' where user_id = 'user_alice'",
      "delete from subscriptions where user_id = 'user_alice'",
      "insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status) values ('user_frank', 's', 'c', 'active')",
    ]) {
      expect((await pgError(() => asUser(db, BOB, (tx) => tx.query(statement))))?.code, statement).toBe("42501");
    }
  });

  it("is_pro() answers for the signed-in user only", async () => {
    const pro = async (user: string) => asUser(db, user, async (tx) => (await tx.query<{ is_pro: boolean }>("select public.is_pro() as is_pro")).rows[0]!.is_pro);
    expect(await pro(ALICE)).toBe(true); // active
    expect(await pro(BOB)).toBe(false); // canceled, period ended
    expect(await pro("user_nobody")).toBe(false);
  });

  it("does not let clients probe anyone else's entitlement", async () => {
    const error = await pgError(() => asUser(db, BOB, (tx) => tx.query(`select public.user_is_pro('${ALICE}')`)));
    expect(error?.code).toBe("42501");
  });

  it("treats trialing and past_due as Pro and ignores long-expired periods", async () => {
    await asService(db, async (tx) => {
      await tx.exec(`
        insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end) values
          ('user_trial', 's1', 'c1', 'trialing', now() + interval '5 days'),
          ('user_late', 's2', 'c2', 'past_due', now() + interval '1 day'),
          ('user_stale', 's3', 'c3', 'active', now() - interval '10 days'),
          ('user_unpaid', 's4', 'c4', 'unpaid', now() + interval '10 days')`);
    });
    const pro = (u: string) => asService(db, async (tx) => (await tx.query<{ p: boolean }>(`select public.user_is_pro('${u}') as p`)).rows[0]!.p);
    expect(await pro("user_trial")).toBe(true);
    expect(await pro("user_late")).toBe(true);
    expect(await pro("user_stale")).toBe(false);
    expect(await pro("user_unpaid")).toBe(false);
  });
});

describe("usage counters", () => {
  it("cannot be written directly, so a quota cannot be reset from the browser", async () => {
    for (const statement of [
      "update usage_counters set count = 0 where user_id = 'user_bob'",
      "delete from usage_counters where user_id = 'user_bob'",
      "insert into usage_counters (user_id, key, count) values ('user_bob', 'x', 0)",
    ]) {
      expect((await pgError(() => asUser(db, BOB, (tx) => tx.query(statement))))?.code, statement).toBe("42501");
    }
  });

  it("increment_usage counts per user and enforces the limit atomically", async () => {
    const bump = (user: string, key: string, limit: number | null) =>
      asUser(db, user, async (tx) => (await tx.query<{ n: number }>("select public.increment_usage($1, $2) as n", [key, limit])).rows[0]!.n);

    expect(await bump("user_gina", "url_import:2026-10", 3)).toBe(1);
    expect(await bump("user_gina", "url_import:2026-10", 3)).toBe(2);
    expect(await bump("user_gina", "url_import:2026-10", 3)).toBe(3);
    const over = await pgError(() => bump("user_gina", "url_import:2026-10", 3));
    expect(over?.message).toContain("limit_exceeded:url_import:2026-10");
    // The rejected attempt rolled back: the counter is still 3, not 4.
    const { rows } = await asService(db, (tx) => tx.query<{ count: number }>("select count from usage_counters where user_id = 'user_gina'"));
    expect(rows[0]!.count).toBe(3);
    // Other users are independent.
    expect(await bump("user_hank", "url_import:2026-10", 3)).toBe(1);
  });

  it("rejects anonymous increments", async () => {
    expect((await pgError(() => asAnon(db, (tx) => tx.query("select public.increment_usage('x', 1)"))))?.code).toBe("42501");
  });
});

describe("free-tier limits (database triggers)", () => {
  const user = "user_free";
  const save = (n: number) =>
    asUser(db, user, async (tx) => {
      const recipe = await tx.query<{ id: string }>(`insert into recipes (source, title) values ('manual', 'R${n}') returning id`);
      await tx.query("insert into saved_recipes (recipe_id) values ($1)", [recipe.rows[0]!.id]);
    });

  it("caps saved recipes for free accounts but not Pro", async () => {
    for (let i = 0; i < FREE_LIMITS.savedRecipes; i++) await save(i);
    const error = await pgError(() => save(99));
    expect(error?.message).toBe("free_limit:saved_recipes");

    await asService(db, (tx) =>
      tx.exec(`insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end)
               values ('${user}', 'sub_free_upgrade', 'cus_free', 'active', now() + interval '30 days')`),
    );
    expect(await pgError(() => save(100))).toBeNull();
  });

  it("caps prep plans at two weeks for free accounts", async () => {
    const u = "user_prepper";
    const plan = (week: string) =>
      asUser(db, u, async (tx) => {
        const p = await tx.query<{ id: string }>("insert into weekly_plans (week_start_date) values ($1) returning id", [week]);
        await tx.query("insert into prep_plans (weekly_plan_id) values ($1)", [p.rows[0]!.id]);
      });
    await plan("2026-09-28");
    await plan("2026-10-05");
    expect((await pgError(() => plan("2026-10-12")))?.message).toBe("free_limit:prep_plans");
  });

  it("allows one photo or video per recipe for free accounts", async () => {
    const u = "user_shutterbug";
    const media = (file: string) =>
      asUser(db, u, async (tx) => {
        await tx.query("insert into recipe_media (recipe_id, kind, storage_path) values ($1, 'photo', $2)", [ids.seededPublished, `${u}/${ids.seededPublished}/${file}`]);
      });
    expect(await pgError(() => media("one.jpg"))).toBeNull();
    expect((await pgError(() => media("two.jpg")))?.message).toBe("free_limit:recipe_media");
  });

  it("does not reveal another user's usage when a row is addressed to them", async () => {
    // Bob has already used his one free photo on this recipe. Alice's spoofed insert must fail
    // with the same RLS error as any other spoof — not a limit error that discloses Bob's state.
    const error = await pgError(() =>
      asUser(db, ALICE, (tx) =>
        tx.query("insert into recipe_media (user_id, recipe_id, kind, storage_path) values ($1, $2, 'photo', $3)", [BOB, ids.seededPublished, `${BOB}/x.jpg`]),
      ),
    );
    expect(error?.code).toBe("42501");
  });

  it("keeps the SQL literals in sync with FREE_LIMITS", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations", readMigration("grants_functions_triggers")),
      "utf8",
    );
    expect(sql).toContain(`IF n >= ${FREE_LIMITS.savedRecipes} THEN\n      RAISE EXCEPTION 'free_limit:saved_recipes'`);
    expect(sql).toContain(`IF n >= ${FREE_LIMITS.prepPlans} THEN\n      RAISE EXCEPTION 'free_limit:prep_plans'`);
    expect(sql).toContain(`IF n >= ${FREE_LIMITS.mediaPerRecipe} THEN\n      RAISE EXCEPTION 'free_limit:recipe_media'`);
  });
});

function readMigration(suffix: string): string {
  const files = readdirSync(path.join(process.cwd(), "supabase/migrations"));
  const match = files.find((f) => f.endsWith(`${suffix}.sql`));
  if (!match) throw new Error(`migration ${suffix} not found`);
  return match;
}

describe("storage (recipe-media bucket)", () => {
  const put = (user: string, name: string) =>
    asUser(db, user, (tx) => tx.query("insert into storage.objects (bucket_id, name, owner_id) values ('recipe-media', $1, $2)", [name, user]));

  it("is private and limited to images and video", async () => {
    const { rows } = await asService(db, (tx) => tx.query<{ public: boolean; allowed_mime_types: string[]; file_size_limit: number }>("select public, allowed_mime_types, file_size_limit from storage.buckets where id = 'recipe-media'"));
    expect(rows[0]!.public).toBe(false);
    expect(rows[0]!.allowed_mime_types).toContain("image/jpeg");
    expect(rows[0]!.allowed_mime_types).toContain("video/mp4");
    expect(rows[0]!.allowed_mime_types).not.toContain("text/html");
  });

  it("lets a user write and read only inside their own folder", async () => {
    expect(await pgError(() => put(ALICE, `${ALICE}/${ids.seededPublished}/a.jpg`))).toBeNull();
    expect((await pgError(() => put(ALICE, `${BOB}/${ids.seededPublished}/evil.jpg`)))?.code).toBe("42501");
    expect((await pgError(() => put(ALICE, `loose-file.jpg`)))?.code).toBe("42501");
    await put(BOB, `${BOB}/${ids.seededPublished}/b.jpg`);

    const seenByAlice = await asUser(db, ALICE, async (tx) => (await tx.query<{ name: string }>("select name from storage.objects order by name")).rows.map((r) => r.name));
    expect(seenByAlice).toEqual([`${ALICE}/${ids.seededPublished}/a.jpg`]);
  });

  it("does not let a user delete or overwrite another user's objects", async () => {
    const deleted = await asUser(db, ALICE, (tx) => tx.query(`delete from storage.objects where name like '${BOB}/%' returning id`));
    expect(deleted.rows).toHaveLength(0);
    const updated = await asUser(db, ALICE, (tx) => tx.query(`update storage.objects set name = '${ALICE}/stolen.jpg' where name like '${BOB}/%' returning id`));
    expect(updated.rows).toHaveLength(0);
  });

  it("keeps recipe_media rows inside the owner's folder", async () => {
    const error = await pgError(() =>
      asUser(db, ALICE, (tx) => tx.query("insert into recipe_media (recipe_id, kind, storage_path) values ($1, 'photo', $2)", [ids.aliceRecipe, `${BOB}/${ids.aliceRecipe}/pointing-at-bob.jpg`])),
    );
    expect(error?.code).toBe("23514");
  });
});

describe("append-only and service-only tables", () => {
  it("lets users add prep-edit log entries but not rewrite history", async () => {
    expect(await pgError(() => asUser(db, ALICE, (tx) => tx.query("insert into prep_edit_log (action, before, after) values ('edit', '{\"title\":\"a\"}', '{\"title\":\"b\"}')")))).toBeNull();
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("update prep_edit_log set action = 'delete'"))))?.code).toBe("42501");
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("delete from prep_edit_log"))))?.code).toBe("42501");
  });

  it("keeps push_deliveries (reminder dedupe) away from clients", async () => {
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query("select * from push_deliveries"))))?.code).toBe("42501");
    await asService(db, (tx) => tx.query("insert into push_deliveries (user_id, kind, local_date) values ($1, 'prep_day', '2026-09-27')", [ALICE]));
    const again = await pgError(() => asService(db, (tx) => tx.query("insert into push_deliveries (user_id, kind, local_date) values ($1, 'prep_day', '2026-09-27')", [ALICE])));
    expect(again?.code).toBe("23505"); // a cron retry can never notify twice
  });
});

describe("data integrity", () => {
  it("only accepts Monday as a week start", async () => {
    const error = await pgError(() => asUser(db, "user_calendar", (tx) => tx.query("insert into weekly_plans (week_start_date) values ('2026-09-29')")));
    expect(error?.code).toBe("23514");
  });

  it("one plan per user per week", async () => {
    const plan = () => asUser(db, "user_twice", (tx) => tx.query("insert into weekly_plans (week_start_date) values ('2026-09-28')"));
    await plan();
    expect((await pgError(plan))?.code).toBe("23505");
  });

  it("deleting a recipe from the book removes its planned meals and everything derived from them", async () => {
    await asService(db, (tx) => tx.exec(`delete from saved_recipes where id = '${ids.aliceSaved}'`));
    const { rows } = await asService(db, (tx) =>
      tx.query<{ meals: number; sources: number; links: number }>(`
        select (select count(*)::int from planned_meals where id = '${ids.aliceMeal}') as meals,
               (select count(*)::int from grocery_item_sources where planned_meal_id = '${ids.aliceMeal}') as sources,
               (select count(*)::int from prep_task_meals where planned_meal_id = '${ids.aliceMeal}') as links`),
    );
    expect(rows[0]).toEqual({ meals: 0, sources: 0, links: 0 });
  });

  it("keeps cooking history when a planned meal is removed from the week", async () => {
    const meal = id(500);
    await asService(db, async (tx) => {
      await tx.exec(`
        insert into saved_recipes (id, user_id, recipe_id) values ('${id(501)}', '${BOB}', '${ids.bobRecipe}');
        insert into planned_meals (id, user_id, weekly_plan_id, saved_recipe_id, planned_date, servings) values ('${meal}', '${BOB}', '${ids.bobPlan}', '${id(501)}', '2026-09-30', 2);
        insert into cooking_events (user_id, saved_recipe_id, planned_meal_id, rating) values ('${BOB}', '${id(501)}', '${meal}', 4);
        delete from planned_meals where id = '${meal}';`);
    });
    const { rows } = await asService(db, (tx) => tx.query<{ planned_meal_id: string | null }>(`select planned_meal_id from cooking_events where saved_recipe_id = '${id(501)}'`));
    expect(rows).toEqual([{ planned_meal_id: null }]);
  });
});
