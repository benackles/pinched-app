/**
 * The real cleanup Edge Function, end to end: `index.ts` running under Deno with the real
 * `supabase-js`, against a real Postgres (PGlite, every migration) served as Supabase's REST API,
 * with a stand-in for Storage's delete endpoint that removes the `storage.objects` row the way
 * Storage does. It proves what unit tests can't: the function starts, checks its secret, reaches
 * Storage as the service role with the request shape supabase-js really sends, and reports only counts.
 *
 * Needs `deno` (CI installs it); skipped where it is missing.
 *   DENO_BIN=/path/to/deno pnpm test tests/edge
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signJwt, verifyJwt } from "@/server/local/jwt";

import { asService, createTestDb, type Db } from "../support/db";
import { denoAvailable, startEdgeFunction, startSupabase } from "../support/edge";
import { ALICE, BOB, seedTwoTenants } from "../support/fixtures";

const JWT_SECRET = "edge-test-shim-secret";
const CRON_SECRET = "cleanup-secret-for-tests";

type StorageCall = { method: string; path: string; role: unknown; prefixes: string[] };

let db: Db;
let supabase: Awaited<ReturnType<typeof startSupabase>>;
let fn: Awaited<ReturnType<typeof startEdgeFunction>>;
let unconfigured: Awaited<ReturnType<typeof startEdgeFunction>>;
const storageCalls: StorageCall[] = [];
let storageDown = false;

const sql = (statement: string) => asService(db, (tx) => tx.exec(statement));
const stored = async () =>
  (await asService(db, (tx) => tx.query<{ name: string }>("select name from storage.objects"))).rows
    .map((row) => row.name)
    .sort();
const upload = (name: string, age: string) =>
  sql(
    `insert into storage.objects (bucket_id, name, owner_id, created_at)
     values ('recipe-media', '${name}', '${ALICE}', now() - interval '${age}')`,
  );

/** What Storage's `DELETE /object/<bucket>` does: requires the service role, answers with what it deleted. */
async function storage(
  request: { method?: string; url?: string; headers: Record<string, unknown> },
  body: Buffer,
) {
  const url = request.url ?? "";
  if (!url.startsWith("/storage/v1/")) return null;

  const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const role = (verifyJwt(token, JWT_SECRET) as { role?: unknown } | null)?.role;
  const prefixes = (JSON.parse(body.toString() || "{}") as { prefixes?: string[] }).prefixes ?? [];
  storageCalls.push({ method: request.method ?? "", path: url, role, prefixes });

  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (role !== "service_role") return json(403, { message: "forbidden" });
  if (storageDown) return json(500, { message: "storage is down" });
  if (request.method !== "DELETE" || url !== "/storage/v1/object/recipe-media") {
    return json(404, { message: "not found" });
  }
  const removed = await asService(db, (tx) =>
    tx.query(
      "delete from storage.objects where bucket_id = 'recipe-media' and name = any($1::text[]) returning name, bucket_id",
      [prefixes],
    ),
  );
  return json(200, removed.rows);
}

const call = (base: string, headers: Record<string, string> = {}, method = "POST") =>
  fetch(base, { method, headers });
const run = async () => {
  const response = await call(fn.url, { authorization: `Bearer ${CRON_SECRET}` });
  return { status: response.status, text: await response.text() };
};

// What the fixtures attach, plus what the tests add.
const ATTACHED = `${ALICE}/published/a.jpg`;
const ABANDONED = [`${ALICE}/published/abandoned-1.jpg`, `${BOB}/published/abandoned-2.mov`];
const FRESH = `${ALICE}/published/fresh.jpg`;

describe.skipIf(!denoAvailable)("cleanup-media under Deno", () => {
  beforeAll(async () => {
    db = await createTestDb();
    await seedTwoTenants(db);
    supabase = await startSupabase(db, JWT_SECRET, (request, body) => storage(request, body));

    const env = {
      SUPABASE_URL: supabase.url,
      SUPABASE_SERVICE_ROLE_KEY: signJwt({ role: "service_role" }, JWT_SECRET, 3600),
    };
    fn = await startEdgeFunction("cleanup-media", { ...env, CLEANUP_CRON_SECRET: CRON_SECRET });
    unconfigured = await startEdgeFunction("cleanup-media", env);
  }, 180_000);

  afterAll(async () => {
    fn?.stop();
    unconfigured?.stop();
    await supabase?.close();
    await db?.close();
  });

  it("only answers POSTs that carry the shared secret", async () => {
    await upload(ABANDONED[0]!, "2 days");

    expect((await call(fn.url, {}, "GET")).status).toBe(405);
    expect((await call(fn.url)).status).toBe(401);
    expect((await call(fn.url, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call(fn.url, { authorization: `Bearer ${CRON_SECRET}x` })).status).toBe(401);

    // Nothing was asked of Storage, and the file is still there.
    expect(storageCalls).toHaveLength(0);
    expect(await stored()).toEqual([ABANDONED[0]]);
    await sql("delete from storage.objects");
  });

  it("refuses to run at all without a secret configured", async () => {
    const response = await call(unconfigured.url, { authorization: `Bearer ${CRON_SECRET}` });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "not configured" });
  });

  it("removes orphaned uploads through Storage as the service role, and only those", async () => {
    await upload(ATTACHED, "3 days");
    await upload(ABANDONED[0]!, "2 days");
    await upload(ABANDONED[1]!, "5 days");
    await upload(FRESH, "2 hours");

    const { status, text } = await run();
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ found: 2, removed: 2, failed: 0, rounds: 2, more: false });

    expect(storageCalls).toEqual([
      {
        method: "DELETE",
        path: "/storage/v1/object/recipe-media",
        role: "service_role",
        // Oldest first.
        prefixes: [ABANDONED[1], ABANDONED[0]],
      },
    ]);
    // What is attached and what is still arriving stay.
    expect(await stored()).toEqual([ATTACHED, FRESH].sort());
  });

  it("answers with counts only — never file names or people's ids", async () => {
    await upload(ABANDONED[0]!, "2 days");
    const { text } = await run();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      "failed",
      "found",
      "more",
      "removed",
      "rounds",
    ]);
    expect(text).not.toContain(ALICE);
    expect(text).not.toContain(BOB);
  });

  it("does nothing on a quiet day", async () => {
    storageCalls.length = 0;
    const { status, text } = await run();
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ found: 0, removed: 0, failed: 0, rounds: 1, more: false });
    expect(storageCalls).toHaveLength(0);
  });

  it("reports a Storage outage, keeps the files, and finishes them next time", async () => {
    await upload(ABANDONED[0]!, "2 days");
    storageDown = true;
    const down = await run();
    expect(down.status).toBe(200);
    expect(JSON.parse(down.text)).toEqual({
      found: 1,
      removed: 0,
      failed: 1,
      rounds: 1,
      more: true,
    });
    expect(await stored()).toContain(ABANDONED[0]);

    storageDown = false;
    const up = await run();
    expect(JSON.parse(up.text)).toMatchObject({ found: 1, removed: 1, failed: 0, more: false });
    expect(await stored()).not.toContain(ABANDONED[0]);
  });
});
