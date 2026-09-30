/**
 * The local PostgREST shim, exercised through the REAL supabase-js client against PGlite running
 * the real migrations — so what passes here is what the app's queries do in local mode, and the
 * RLS rules apply exactly as they do behind Supabase.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/types";
import { signJwt, verifyJwt } from "@/server/local/jwt";
import { handlePostgrest, type Queryable } from "@/server/local/postgrest/handler";

import { createTestDb, type Db } from "../support/db";
import { ALICE, BOB, id, ids, seedTwoTenants } from "../support/fixtures";

const SECRET = "test-secret";
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await seedTwoTenants(db);
});
afterAll(async () => {
  await db.close();
});

const fetchShim = (input: RequestInfo | URL, init?: RequestInit) =>
  handlePostgrest(new Request(input, init), {
    db: db as unknown as Queryable,
    verifyToken: (token) => verifyJwt(token, SECRET),
  });

const tokenFor = (sub: string) => signJwt({ sub, role: "authenticated" }, SECRET, 600);
/** Supabase's anon key is itself a JWT (role "anon"); supabase-js falls back to it when signed out. */
const ANON_KEY = signJwt({ role: "anon" }, SECRET, 3600);

function as(user: string | null) {
  return createClient<Database>("http://shim.test", ANON_KEY, {
    accessToken: async () => (user ? tokenFor(user) : null),
    global: { fetch: fetchShim },
  });
}

describe("reads", () => {
  it("selects columns, filters and orders like PostgREST", async () => {
    const { data, error } = await as(ALICE)
      .from("recipes")
      .select("title, servings")
      .order("title", { ascending: false });
    expect(error).toBeNull();
    expect(data).toEqual([
      { title: "Published catalog recipe", servings: 4 },
      { title: "Alice private recipe", servings: 2 },
    ]);
  });

  it("supports eq / neq / in / is / not / ilike / or / gte", async () => {
    const c = as(ALICE);
    expect((await c.from("recipes").select("title").eq("source", "manual")).data).toEqual([
      { title: "Alice private recipe" },
    ]);
    expect((await c.from("recipes").select("title").neq("source", "manual")).data).toEqual([
      { title: "Published catalog recipe" },
    ]);
    expect(
      (await c.from("recipes").select("title").in("id", [ids.aliceRecipe, ids.seededPublished]))
        .data,
    ).toHaveLength(2);
    expect((await c.from("recipes").select("title").in("id", [])).data).toEqual([]);
    expect((await c.from("recipes").select("title").is("slug", null)).data).toEqual([
      { title: "Alice private recipe" },
    ]);
    expect((await c.from("recipes").select("title").not("slug", "is", null)).data).toEqual([
      { title: "Published catalog recipe" },
    ]);
    expect((await c.from("recipes").select("title").ilike("title", "%PRIVATE%")).data).toEqual([
      { title: "Alice private recipe" },
    ]);
    expect(
      (await c.from("recipes").select("title").or("source.eq.manual,title.ilike.*catalog*")).data,
    ).toHaveLength(2);
    expect((await c.from("recipes").select("title").gte("servings", 3)).data).toEqual([
      { title: "Published catalog recipe" },
    ]);
  });

  it("supports nested and/or groups", async () => {
    const { data } = await as(ALICE)
      .from("recipes")
      .select("title")
      .or("and(source.eq.manual,servings.lt.3),and(source.eq.seeded,servings.gt.10)");
    expect(data).toEqual([{ title: "Alice private recipe" }]);
  });

  it("returns typed JSON: numerics as numbers, arrays, dates and jsonb", async () => {
    const c = as(ALICE);
    await c.from("kitchen_items").insert({
      name: "Sugar",
      normalized_name: "sugar",
      quantity: 2.5,
      unit: "cup",
      expires_at: "2027-01-02",
    });
    const { data } = await c
      .from("kitchen_items")
      .select("quantity, unit, expires_at, created_at")
      .eq("normalized_name", "sugar")
      .single();
    expect(data?.quantity).toBe(2.5);
    expect(data?.expires_at).toBe("2027-01-02");
    expect(typeof data?.created_at).toBe("string");

    const mods = await c.from("recipe_modifications").select("changes").single();
    expect(mods.data?.changes).toEqual({ title: "Alice version" });
    const tags = await c.from("recipes").select("tags").eq("id", ids.seededPublished).single();
    expect(tags.data?.tags).toEqual([]);
  });

  it("enforces RLS: each user sees only their own rows", async () => {
    const alice = await as(ALICE).from("kitchen_items").select("name");
    const bob = await as(BOB).from("kitchen_items").select("name");
    expect(alice.data?.map((r) => r.name)).toContain("Rice");
    expect(alice.data?.map((r) => r.name)).not.toContain("Flour (bob)");
    expect(bob.data?.map((r) => r.name)).toEqual(["Flour"]);
  });

  it("counts, ranges and heads", async () => {
    const c = as(ALICE);
    const counted = await c.from("recipes").select("*", { count: "exact" }).limit(1);
    expect(counted.count).toBe(2);
    expect(counted.data).toHaveLength(1);
    const head = await c.from("recipes").select("*", { count: "exact", head: true });
    expect(head.count).toBe(2);
    expect(head.data).toBeNull();
    const ranged = await c.from("recipes").select("title").order("title").range(1, 1);
    expect(ranged.data).toEqual([{ title: "Published catalog recipe" }]);
  });

  it("single() / maybeSingle() report zero or many rows the PostgREST way", async () => {
    const c = as(ALICE);
    const none = await c.from("recipes").select("*").eq("title", "nope").single();
    expect(none.error?.code).toBe("PGRST116");
    const many = await c.from("recipes").select("*").single();
    expect(many.error?.code).toBe("PGRST116");
    const maybe = await c.from("recipes").select("*").eq("title", "nope").maybeSingle();
    expect(maybe).toMatchObject({ data: null, error: null });
  });

  it("rejects unknown tables, columns and unsupported syntax with PostgREST-shaped errors", async () => {
    const c = as(ALICE);
    expect((await c.from("nope" as never).select("*")).error?.code).toBe("PGRST205");
    expect((await c.from("recipes").select("nope" as never)).error?.code).toBe("42703");
    expect(
      (
        await c
          .from("recipes")
          .select("*")
          .eq("nope" as never, 1)
      ).error?.code,
    ).toBe("42703");
    const embed = await c.from("saved_recipes").select("*, recipes(*)");
    expect(embed.error?.message).toMatch(/embedding/i);
  });
});

describe("authentication", () => {
  it("treats a missing token as anon, which has no table access", async () => {
    const { error, status } = await as(null).from("recipes").select("*");
    expect(error?.code).toBe("42501");
    expect(status).toBe(401);
  });

  it("rejects tokens with a bad signature or that have expired", async () => {
    const forged = createClient<Database>("http://shim.test", "k", {
      accessToken: async () => signJwt({ sub: ALICE, role: "authenticated" }, "other-secret", 60),
      global: { fetch: fetchShim },
    });
    expect((await forged.from("recipes").select("*")).error?.code).toBe("PGRST301");
    const expired = createClient<Database>("http://shim.test", "k", {
      accessToken: async () => signJwt({ sub: ALICE, role: "authenticated" }, SECRET, -10),
      global: { fetch: fetchShim },
    });
    expect((await expired.from("recipes").select("*")).error?.code).toBe("PGRST303");
  });

  it("never lets a client pick a different role than its token's", async () => {
    const anonToken = createClient<Database>("http://shim.test", "k", {
      accessToken: async () => signJwt({ sub: ALICE, role: "postgres" }, SECRET, 60),
      global: { fetch: fetchShim },
    });
    const { error } = await anonToken.from("recipes").select("*");
    expect(error).not.toBeNull();
  });
});

describe("writes", () => {
  it("stamps user_id from the token, never from the client", async () => {
    const c = as(ALICE);
    const { data, error } = await c
      .from("collections")
      .insert({ name: "Stamped" })
      .select("user_id, name")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ user_id: ALICE, name: "Stamped" });
    const spoof = await c.from("collections").insert({ name: "Spoof", user_id: BOB });
    expect(spoof.error?.code).toBe("42501");
  });

  it("bulk-inserts, and returns representation only when asked", async () => {
    const c = as(ALICE);
    const quiet = await c.from("kitchen_items").insert([
      { name: "A", normalized_name: "a" },
      { name: "B", normalized_name: "b", quantity: 3 },
    ]);
    expect(quiet).toMatchObject({ data: null, error: null, status: 201 });
    const loud = await c
      .from("kitchen_items")
      .insert([
        { name: "C", normalized_name: "c", location: "pantry" },
        { name: "D", normalized_name: "d", location: "fridge" },
      ])
      .select("name, location, quantity")
      .order("name");
    expect(loud.data).toEqual([
      { name: "C", location: "pantry", quantity: null },
      { name: "D", location: "fridge", quantity: null },
    ]);
    // Like PostgREST, a key missing from some rows of a bulk insert is NULL, not the column default.
    const ragged = await c.from("kitchen_items").insert([
      { name: "E", normalized_name: "e" },
      { name: "F", normalized_name: "f", location: "fridge" },
    ]);
    expect(ragged.error?.code).toBe("23502");
  });

  it("maps constraint violations to PostgREST status codes", async () => {
    const c = as(ALICE);
    await c.from("collections").insert({ name: "Unique" });
    const dupe = await c.from("collections").insert({ name: "Unique" });
    expect(dupe.error?.code).toBe("23505");
    expect(dupe.status).toBe(409);
    const check = await c
      .from("kitchen_items")
      .insert({ name: "x", normalized_name: "x", location: "garage" });
    expect(check.error?.code).toBe("23514");
    expect(check.status).toBe(400);
    const notNull = await c.from("kitchen_items").insert({ normalized_name: "x" } as never);
    expect(notNull.error?.code).toBe("23502");
    const unknown = await c
      .from("kitchen_items")
      .insert({ name: "x", normalized_name: "x", bogus: 1 } as never);
    expect(unknown.error?.code).toBe("PGRST204");
  });

  it("upserts with merge and ignore resolution on a chosen conflict target", async () => {
    const c = as(ALICE);
    await c
      .from("weekly_plans")
      .upsert({ week_start_date: "2026-11-02" }, { onConflict: "user_id,week_start_date" });
    const merged = await c
      .from("weekly_plans")
      .upsert(
        { week_start_date: "2026-11-02", status: "archived" },
        { onConflict: "user_id,week_start_date" },
      )
      .select("status");
    expect(merged.data).toEqual([{ status: "archived" }]);
    const ignored = await c
      .from("weekly_plans")
      .upsert(
        { week_start_date: "2026-11-02", status: "active" },
        { onConflict: "user_id,week_start_date", ignoreDuplicates: true },
      )
      .select("status");
    expect(ignored.data).toEqual([]);
    const still = await c
      .from("weekly_plans")
      .select("status")
      .eq("week_start_date", "2026-11-02")
      .single();
    expect(still.data?.status).toBe("archived");
  });

  it("updates matching rows and returns them; RLS makes other people's rows a silent no-op", async () => {
    const c = as(ALICE);
    const mine = await c
      .from("kitchen_items")
      .update({ quantity: 9 })
      .eq("normalized_name", "rice")
      .select("quantity");
    expect(mine.data).toEqual([{ quantity: 9 }]);
    const theirs = await c
      .from("kitchen_items")
      .update({ quantity: 1 })
      .eq("normalized_name", "flour")
      .select("name");
    expect(theirs.data).toEqual([]);
    const bobFlour = await as(BOB)
      .from("kitchen_items")
      .select("quantity")
      .eq("normalized_name", "flour")
      .single();
    expect(bobFlour.data?.quantity).toBeNull();
  });

  it("rolls back a single-row write that did not match exactly one row", async () => {
    const c = as(ALICE);
    const miss = await c
      .from("kitchen_items")
      .update({ quantity: 5 })
      .eq("normalized_name", "no-such")
      .select()
      .single();
    expect(miss.error?.code).toBe("PGRST116");
    const two = await c
      .from("kitchen_items")
      .update({ note: "t" })
      .in("normalized_name", ["a", "b"])
      .select()
      .single();
    expect(two.error?.code).toBe("PGRST116");
    const untouched = await c
      .from("kitchen_items")
      .select("note")
      .in("normalized_name", ["a", "b"]);
    expect(untouched.data?.every((r) => r.note === null)).toBe(true);
  });

  it("deletes with filters", async () => {
    const c = as(ALICE);
    await c.from("collections").insert({ name: "Doomed" });
    const gone = await c.from("collections").delete().eq("name", "Doomed").select("name");
    expect(gone.data).toEqual([{ name: "Doomed" }]);
    expect((await c.from("collections").select("*").eq("name", "Doomed")).data).toEqual([]);
    // someone else's row is invisible, so nothing is deleted
    const bobs = await c.from("collections").delete().eq("id", ids.bobCollection).select();
    expect(bobs.data).toEqual([]);
  });

  it("writes jsonb and arrays", async () => {
    const c = as(ALICE);
    const { data, error } = await c
      .from("recipes")
      .insert({ source: "manual", title: "Tagged", tags: ["quick", "vegan"] })
      .select("tags")
      .single();
    expect(error).toBeNull();
    expect(data?.tags).toEqual(["quick", "vegan"]);
    const mod = await c
      .from("recipe_modifications")
      .update({ changes: { title: "Edited", servings: 6 } })
      .eq("saved_recipe_id", ids.aliceSaved)
      .select("changes")
      .single();
    expect(mod.data?.changes).toEqual({ title: "Edited", servings: 6 });
  });
});

describe("rpc", () => {
  it("returns scalars", async () => {
    const c = as(ALICE);
    expect((await c.rpc("is_pro")).data).toBe(true);
    expect((await as(BOB).rpc("is_pro")).data).toBe(false);
    const first = await c.rpc("increment_usage", { p_key: "shim:test", p_limit: 2 });
    expect(first.data).toBe(1);
    expect((await c.rpc("increment_usage", { p_key: "shim:test", p_limit: 2 })).data).toBe(2);
  });

  it("surfaces raised exceptions and privilege errors", async () => {
    const c = as(ALICE);
    const over = await c.rpc("increment_usage", { p_key: "shim:test", p_limit: 2 });
    expect(over.error?.message).toBe("limit_exceeded:shim:test");
    expect(over.status).toBe(400);
    const hidden = await c.rpc("user_is_pro" as never, { p_user_id: BOB } as never);
    expect(hidden.error?.code).toBe("42501");
    const missing = await c.rpc("no_such_fn" as never);
    expect(missing.error?.code).toBe("PGRST202");
  });
});

describe("the ids fixture", () => {
  it("is well-formed", () => {
    expect(id(1)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
