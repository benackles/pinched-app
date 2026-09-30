import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildCatalog } from "@/lib/catalog/build";
import { loadCatalog } from "@/lib/catalog/load";

import { asUser, createTestDb, type Db } from "../support/db";

const count = async (db: Db, sql: string) => {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`);
  return rows[0]!.n;
};

describe("seed.sql against the real schema", () => {
  let db: Db;
  const catalog = loadCatalog();
  const published = loadCatalog({ publishAll: true });
  const total = catalog.recipes.length;
  const ingredientTotal = catalog.recipes.reduce((sum, r) => sum + r.ingredients.length, 0);
  const stepTotal = catalog.recipes.reduce((sum, r) => sum + r.steps.length, 0);

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("loads every recipe, ingredient and step, hidden until reviewed", async () => {
    await db.exec(catalog.sql);
    expect(await count(db, "public.recipes where source = 'seeded'")).toBe(total);
    expect(await count(db, "public.ingredients")).toBe(ingredientTotal);
    expect(await count(db, "public.recipe_steps")).toBe(stepTotal);
    expect(await count(db, "public.recipes where published_at is not null")).toBe(
      catalog.recipes.filter((r) => r.reviewed).length,
    );
  });

  it("is idempotent: re-running replaces ingredients and steps instead of duplicating them", async () => {
    await db.exec(catalog.sql);
    await db.exec(catalog.sql);
    expect(await count(db, "public.recipes where source = 'seeded'")).toBe(total);
    expect(await count(db, "public.ingredients")).toBe(ingredientTotal);
    expect(await count(db, "public.recipe_steps")).toBe(stepTotal);
  });

  it("keeps unreviewed recipes invisible to signed-in users", async () => {
    const visible = await asUser(db, "user_a", async (tx) => {
      const recipes = await tx.query("select id from public.recipes");
      const ingredients = await tx.query("select id from public.ingredients");
      return { recipes: recipes.rows.length, ingredients: ingredients.rows.length };
    });
    expect(visible).toEqual({
      recipes: catalog.recipes.filter((r) => r.reviewed).length,
      ingredients: catalog.recipes
        .filter((r) => r.reviewed)
        .reduce((s, r) => s + r.ingredients.length, 0),
    });
  });

  it("publishes everything for dev, and a later unpublished build never hides a published recipe", async () => {
    await db.exec(published.sql);
    await db.exec(catalog.sql);
    const visible = await asUser(db, "user_a", async (tx) => ({
      recipes: (await tx.query("select id from public.recipes")).rows.length,
      ingredients: (await tx.query("select id from public.ingredients")).rows.length,
      steps: (await tx.query("select id from public.recipe_steps")).rows.length,
    }));
    expect(visible).toEqual({ recipes: total, ingredients: ingredientTotal, steps: stepTotal });
  });

  it("stores parsed, aisle-sorted ingredients with contiguous ordering", async () => {
    const { rows } = await db.query<{
      slug: string;
      sort_order: number;
      normalized_name: string;
      grocery_section: string;
    }>(
      `select r.slug, i.sort_order, i.normalized_name, i.grocery_section
         from public.ingredients i join public.recipes r on r.id = i.recipe_id
        order by r.slug, i.sort_order`,
    );
    const bySlug = new Map<string, number[]>();
    for (const row of rows) {
      expect(row.normalized_name, `${row.slug}#${row.sort_order}`).toBeTruthy();
      expect(row.grocery_section).toBeTruthy();
      bySlug.set(row.slug, [...(bySlug.get(row.slug) ?? []), row.sort_order]);
    }
    for (const [slug, orders] of bySlug)
      expect(orders, slug).toEqual(orders.map((_, index) => index));
  });

  it("lets nobody but the seed edit catalog recipes", async () => {
    const updated = await asUser(db, "user_a", async (tx) => {
      const result = await tx.query(
        "update public.recipes set title = 'hijacked' where source = 'seeded' returning id",
      );
      return result.rows.length;
    });
    expect(updated).toBe(0);
    expect(await count(db, "public.recipes where title = 'hijacked'")).toBe(0);
  });

  it("matches what buildCatalog generates for the same input", () => {
    expect(buildCatalog(catalog.recipes).sql).toBe(catalog.sql);
  });
});
