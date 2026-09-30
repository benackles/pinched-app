/**
 * The orphaned-upload sweep: which files `orphaned_media_objects()` names (the real migration on a
 * real Postgres), and what the job does with them (supabase-js through the PostgREST shim, with
 * Storage replaced by a stand-in that deletes the `storage.objects` row the way Storage does).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MEDIA_BUCKET as APP_BUCKET } from "@/lib/media/upload";

import {
  MEDIA_BUCKET,
  runCleanup,
  type Remover,
} from "../../supabase/functions/cleanup-media/core.ts";
import { serviceClient } from "../support/admin";
import { asAnon, asService, asUser, createTestDb, pgError, type Db } from "../support/db";
import { ALICE, BOB, seedTwoTenants } from "../support/fixtures";

let db: Db;

const sql = (statement: string) => asService(db, (tx) => tx.exec(statement));
const query = async <T>(statement: string, params?: unknown[]) =>
  (await asService(db, (tx) => tx.query<T>(statement, params))).rows;

/** What the database says is orphaned right now. */
const listed = async (minAge?: string) =>
  (
    await query<{ name: string }>(
      minAge
        ? `select name from public.orphaned_media_objects('${minAge}')`
        : "select name from public.orphaned_media_objects()",
    )
  ).map((row) => row.name);

/** What is actually in storage (sorted here, so the comparison doesn't depend on collation). */
const stored = async () =>
  (await query<{ name: string }>("select name from storage.objects")).map((row) => row.name).sort();

/** A file in a bucket, uploaded `age` ago. */
const upload = (name: string, age: string, bucket = "recipe-media") =>
  sql(
    `insert into storage.objects (bucket_id, name, owner_id, created_at)
     values ('${bucket}', '${name}', '${ALICE}', now() - interval '${age}')`,
  );

/** `count` old files nobody attached, in one statement. */
const bulkOrphans = (count: number) =>
  sql(
    `insert into storage.objects (bucket_id, name, owner_id, created_at)
     select 'recipe-media', '${ALICE}/bulk/' || lpad(n::text, 5, '0') || '.jpg', '${ALICE}',
            now() - interval '3 days' - n * interval '1 second'
     from generate_series(1, ${count}) n`,
  );

// The files the fixtures attach (recipe_media rows) — see tests/support/fixtures.ts.
const ATTACHED_A = `${ALICE}/published/a.jpg`;
const ATTACHED_B = `${BOB}/published/b.jpg`;
const ABANDONED = `${ALICE}/published/abandoned.jpg`;
const OLDEST = `${BOB}/published/abandoned.mov`;
const FRESH = `${ALICE}/published/fresh.jpg`;
const OTHER_BUCKET = `${ALICE}/avatar.png`;

beforeAll(async () => {
  db = await createTestDb();
  await seedTwoTenants(db);
  await sql(
    "insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false) on conflict do nothing",
  );
});

afterAll(async () => {
  await db.close();
});

/** The same small scene before every test: two attached files, two abandoned, one still arriving. */
beforeEach(async () => {
  await sql("delete from storage.objects");
  await upload(ATTACHED_A, "3 days");
  await upload(ATTACHED_B, "3 days");
  await upload(ABANDONED, "2 days");
  await upload(OLDEST, "5 days");
  await upload(FRESH, "2 hours");
  await upload(OTHER_BUCKET, "10 days", "avatars");
});

describe("orphaned_media_objects()", () => {
  it("names old files that no photo or video points at, oldest first", async () => {
    // Not listed: the two attached files, the upload that is only two hours old, and the file in
    // another bucket.
    expect(await listed()).toEqual([OLDEST, ABANDONED]);
  });

  it("takes the grace period as an argument", async () => {
    expect(await listed("1 hour")).toEqual([OLDEST, ABANDONED, FRESH]);
    expect(await listed("3 days")).toEqual([OLDEST]);
    expect(await listed("30 days")).toEqual([]);
  });

  it("stops naming a file once it is attached", async () => {
    await sql(
      `insert into recipe_media (user_id, recipe_id, kind, storage_path)
       select '${ALICE}', recipe_id, 'photo', '${ABANDONED}' from saved_recipes where user_id = '${ALICE}' limit 1`,
    );
    try {
      expect(await listed()).toEqual([OLDEST]);
    } finally {
      await sql(`delete from recipe_media where storage_path = '${ABANDONED}'`);
    }
    expect(await listed()).toEqual([OLDEST, ABANDONED]);
  });

  it("returns at most 1000 names a call", async () => {
    await bulkOrphans(1005);
    const names = await listed();
    expect(names).toHaveLength(1000);
    // Oldest first, so the next call picks up where this one would have stopped.
    expect(names[0]).toBe(OLDEST);
  });

  it("can be called by the service role only", async () => {
    const call = "select * from public.orphaned_media_objects()";
    expect((await pgError(() => asUser(db, ALICE, (tx) => tx.query(call))))?.code).toBe("42501");
    expect((await pgError(() => asAnon(db, (tx) => tx.query(call))))?.code).toBe("42501");
    expect(await pgError(() => asService(db, (tx) => tx.query(call)))).toBeNull();
  });

  it("looks at the bucket the app uploads to", () => {
    expect(MEDIA_BUCKET).toBe(APP_BUCKET);
    const dir = path.join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("orphaned_media.sql"))!;
    expect(readFileSync(path.join(dir, file), "utf8")).toContain(`bucket_id = '${MEDIA_BUCKET}'`);
  });
});

describe("runCleanup", () => {
  /** Storage, as far as the job can tell: it deletes the named objects and says how many went. */
  const calls: string[][] = [];
  const storage: Remover = async (names) => {
    calls.push(names);
    const removed = await query<{ name: string }>(
      "delete from storage.objects where bucket_id = 'recipe-media' and name = any($1::text[]) returning name",
      [names],
    );
    return removed.length;
  };
  const run = (options: Partial<Parameters<typeof runCleanup>[0]> = {}) =>
    runCleanup({ admin: serviceClient(db), remove: storage, ...options });

  beforeEach(() => {
    calls.length = 0;
  });

  it("removes the orphans and nothing else", async () => {
    const summary = await run();

    expect(summary).toEqual({ found: 2, removed: 2, failed: 0, rounds: 2, more: false });
    expect(calls).toEqual([[OLDEST, ABANDONED]]);
    // What is attached, what is still arriving and what belongs to another bucket all stay.
    expect(await stored()).toEqual([ATTACHED_A, ATTACHED_B, OTHER_BUCKET, FRESH].sort());
  });

  it("does nothing when there is nothing to do", async () => {
    await run();
    calls.length = 0;
    expect(await run()).toEqual({ found: 0, removed: 0, failed: 0, rounds: 1, more: false });
    expect(calls).toEqual([]);
  });

  it("removes in batches of 100", async () => {
    await bulkOrphans(250);
    const summary = await run();

    expect(summary).toEqual({ found: 252, removed: 252, failed: 0, rounds: 2, more: false });
    expect(calls.map((batch) => batch.length)).toEqual([100, 100, 52]);
    expect(await listed()).toEqual([]);
  });

  it("carries on past one round's worth", async () => {
    await bulkOrphans(1200);
    const summary = await run();

    expect(summary).toEqual({ found: 1202, removed: 1202, failed: 0, rounds: 3, more: false });
    expect(await listed()).toEqual([]);
    expect(await stored()).toEqual([ATTACHED_A, ATTACHED_B, OTHER_BUCKET, FRESH].sort());
  });

  it("caps a run and says there is more", async () => {
    await bulkOrphans(1200);
    const summary = await run({ maxRounds: 1 });

    expect(summary).toEqual({ found: 1000, removed: 1000, failed: 0, rounds: 1, more: true });
    expect(await listed()).toHaveLength(202);
  });

  it("reports a batch Storage refuses, removes the rest, and stops rather than spin", async () => {
    await bulkOrphans(250);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const flaky: Remover = async (names) => {
      if (++n === 2) throw new Error("storage is unhappy");
      return storage(names);
    };

    const summary = await run({ remove: flaky });
    expect(summary).toEqual({ found: 252, removed: 152, failed: 100, rounds: 1, more: true });
    expect(await listed()).toHaveLength(100);

    // The log says what happened, never which files — their names hold people's ids.
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("storage is unhappy");
    expect(logged).not.toContain(ALICE);
    expect(logged).not.toContain(BOB);
    warn.mockRestore();

    // Next run, Storage is back: the stragglers go.
    expect(await run()).toEqual({ found: 100, removed: 100, failed: 0, rounds: 2, more: false });
    expect(await listed()).toEqual([]);
  });

  it("stops when a round removes nothing", async () => {
    const summary = await run({ remove: async () => 0 });
    expect(summary).toEqual({ found: 2, removed: 0, failed: 0, rounds: 1, more: true });
  });

  it("fails loudly when the database can't be asked", async () => {
    await expect(run({ minAge: "soon" })).rejects.toThrow(/list orphans/);
    expect(calls).toEqual([]);
  });

  it("never hands Storage anything but real names", async () => {
    // A changed response shape (scalars, nulls) must stop the job, not delete whatever that becomes.
    for (const data of [["a.jpg"], [{ name: null }], [{}], [{ name: "" }]]) {
      const admin = { rpc: async () => ({ data, error: null }) } as never;
      await expect(run({ admin })).rejects.toThrow(/unexpected response/);
    }
    expect(calls).toEqual([]);
  });

  it("honours the grace period it is given", async () => {
    const summary = await run({ minAge: "1 hour" });
    expect(summary.removed).toBe(3);
    expect(await stored()).toEqual([ATTACHED_A, ATTACHED_B, OTHER_BUCKET].sort());
  });
});
