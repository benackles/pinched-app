import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleClerkEvent, purgeUserData } from "@/server/clerk/webhook";
import type { MediaStore } from "@/server/media/store";

import { serviceClient } from "../support/admin";
import { createTestDb, type Db } from "../support/db";
import { ALICE, BOB, seedTwoTenants } from "../support/fixtures";

let db: Db;

const admin = () => serviceClient(db);

beforeAll(async () => {
  db = await createTestDb();
  await seedTwoTenants(db);
});
afterAll(async () => {
  await db.close();
});

/** A storage double that records what was asked of it, and can be made to fail. */
function fakeStore(
  options: { fail?: boolean; onRemove?: (paths: string[]) => Promise<void> } = {},
) {
  const removed: string[] = [];
  const store: MediaStore = {
    createUpload: async () => {
      throw new Error("not used");
    },
    info: async () => null,
    sign: async () => new Map(),
    remove: async (paths) => {
      await options.onRemove?.(paths);
      if (options.fail) throw new Error("storage unavailable");
      removed.push(...paths);
    },
  };
  return { store, removed };
}

const count = async (table: string, column: string, user: string) =>
  (
    await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${column} = $1`, [
      user,
    ])
  ).rows[0]?.n ?? 0;

const USER_TABLES: [string, string][] = [
  ["profiles", "user_id"],
  ["subscriptions", "user_id"],
  ["usage_counters", "user_id"],
  ["saved_recipes", "user_id"],
  ["recipe_modifications", "user_id"],
  ["recipe_notes", "user_id"],
  ["recipe_media", "user_id"],
  ["collections", "user_id"],
  ["collection_items", "user_id"],
  ["kitchen_items", "user_id"],
  ["weekly_plans", "user_id"],
  ["planned_meals", "user_id"],
  ["grocery_lists", "user_id"],
  ["grocery_list_items", "user_id"],
  ["grocery_item_sources", "user_id"],
  ["prep_plans", "user_id"],
  ["prep_tasks", "user_id"],
  ["prep_task_meals", "user_id"],
  ["prep_edit_log", "user_id"],
  ["cooking_events", "user_id"],
  ["push_subscriptions", "user_id"],
  ["recipes", "owner_id"],
];

describe("Clerk webhook", () => {
  it("user.created mirrors the person into profiles, using the primary email", async () => {
    const result = await handleClerkEvent(
      {
        type: "user.created",
        data: {
          id: "user_new",
          first_name: "Sam",
          last_name: "Cook",
          primary_email_address_id: "idn_2",
          email_addresses: [
            { id: "idn_1", email_address: "old@example.test" },
            { id: "idn_2", email_address: "sam@example.test" },
          ],
        },
      },
      { admin: admin() },
    );
    expect(result.handled).toBe(true);
    expect(
      (await db.query("select email, name from profiles where user_id = 'user_new'")).rows[0],
    ).toEqual({
      email: "sam@example.test",
      name: "Sam Cook",
    });
  });

  it("user.updated changes the mirror without touching preferences", async () => {
    await db.exec("update profiles set prep_day = 6 where user_id = 'user_new'");
    await handleClerkEvent(
      {
        type: "user.updated",
        data: {
          id: "user_new",
          first_name: "Samantha",
          email_addresses: [{ id: "x", email_address: "sam2@example.test" }],
        },
      },
      { admin: admin() },
    );
    expect(
      (await db.query("select email, name, prep_day from profiles where user_id = 'user_new'"))
        .rows[0],
    ).toMatchObject({
      email: "sam2@example.test",
      name: "Samantha",
    });
  });

  it("user.deleted removes every row the person owns — and nobody else's", async () => {
    const before = await Promise.all(USER_TABLES.map(([t, c]) => count(t, c, ALICE)));
    expect(before.filter((n) => n > 0).length).toBeGreaterThan(15); // the fixture really populated them

    const cancelled: string[] = [];
    const files = fakeStore();
    const result = await handleClerkEvent(
      { type: "user.deleted", data: { id: ALICE, deleted: true } },
      {
        admin: admin(),
        media: files.store,
        cancelSubscriptions: async (id) => void cancelled.push(id),
      },
    );
    expect(result.handled).toBe(true);
    expect(cancelled).toEqual([ALICE]); // billing is stopped first
    // Their photos and videos are removed from storage too — and only theirs.
    expect(files.removed).toEqual([`${ALICE}/published/a.jpg`]);

    for (const [table, column] of USER_TABLES) {
      expect(
        await count(table, column, ALICE),
        `${table} still has rows for the deleted user`,
      ).toBe(0);
    }
    for (const [table, column] of USER_TABLES) {
      if (table === "profiles" || table === "weekly_plans" || table === "kitchen_items") {
        expect(
          await count(table, column, BOB),
          `${table} lost someone else's rows`,
        ).toBeGreaterThan(0);
      }
    }
    // Catalog recipes survive.
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from recipes where source = 'seeded'",
        )
      ).rows[0]?.n,
    ).toBeGreaterThan(0);
  });

  it("does not delete anything if stopping billing fails (Clerk will retry)", async () => {
    await expect(
      handleClerkEvent(
        { type: "user.deleted", data: { id: BOB } },
        {
          admin: admin(),
          media: fakeStore().store,
          cancelSubscriptions: async () => {
            throw new Error("stripe unavailable");
          },
        },
      ),
    ).rejects.toThrow("stripe unavailable");
    expect(await count("profiles", "user_id", BOB)).toBe(1);
  });

  it("removes files before rows, and keeps everything if storage fails (Clerk will retry)", async () => {
    // Files first: when storage is asked to remove them, the database rows still exist.
    let rowsWhenRemoving = -1;
    const files = fakeStore({
      onRemove: async () => {
        rowsWhenRemoving = await count("recipe_media", "user_id", BOB);
      },
    });
    const failing = fakeStore({ fail: true });
    await expect(purgeUserData(admin(), BOB, failing.store)).rejects.toThrow("storage unavailable");
    // Nothing was deleted, so the retry can finish the job.
    expect(await count("profiles", "user_id", BOB)).toBe(1);
    expect(await count("recipe_media", "user_id", BOB)).toBe(1);

    await purgeUserData(admin(), BOB, files.store);
    expect(rowsWhenRemoving).toBe(1);
    expect(files.removed).toEqual([`${BOB}/published/b.jpg`]);
    expect(await count("profiles", "user_id", BOB)).toBe(0);
  });

  it("purgeUserData is safe to run twice", async () => {
    const { store } = fakeStore();
    await purgeUserData(admin(), ALICE, store);
    await purgeUserData(admin(), ALICE, store);
  });
});
