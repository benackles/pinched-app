/**
 * The real Edge Function, end to end: `index.ts` running under Deno, with the real `web-push`
 * library and the real `supabase-js`, against a real Postgres (PGlite, every migration) served over
 * HTTP, sending to a fake push service. It proves what unit tests can't: the function starts, checks
 * its secret, signs a valid VAPID token, encrypts the payload so only the device can read it, and
 * reacts to the push service's answers.
 *
 * Needs `deno` and `openssl` (CI installs Deno); skipped where they are missing.
 *   DENO_BIN=/path/to/deno pnpm test tests/edge
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  createECDH,
  createPublicKey,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signJwt, verifyJwt } from "@/server/local/jwt";
import { handlePostgrest, type Queryable } from "@/server/local/postgrest/handler";

import { asService, createTestDb, type Db } from "../support/db";

const DENO = process.env.DENO_BIN ?? "deno";
const has = (command: string, args: string[]) => {
  try {
    return spawnSync(command, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
};
const available = has(DENO, ["--version"]) && has("openssl", ["version"]);

const SECRET = "edge-test-shim-secret";
const CRON_SECRET = "cron-secret-for-tests";
const b64url = (buffer: Buffer) => buffer.toString("base64url");

type Captured = { path: string; headers: http.IncomingHttpHeaders; body: Buffer };

// ─────────────────────────────── a device that can decrypt ───────────────────────────────

function makeDevice() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    publicKey: ecdh.getPublicKey(), // 65 bytes, uncompressed
    p256dh: b64url(ecdh.getPublicKey()),
    auth: b64url(auth),
    /** RFC 8291 (aes128gcm): what the push service relayed, decrypted the way a browser does. */
    decrypt(body: Buffer): string {
      const salt = body.subarray(0, 16);
      const idLength = body[20]!;
      const senderPublic = body.subarray(21, 21 + idLength);
      const ciphertext = body.subarray(21 + idLength);

      const shared = ecdh.computeSecret(senderPublic);
      const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), this.publicKey, senderPublic]);
      const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
      const cek = Buffer.from(
        hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
      );
      const nonce = Buffer.from(
        hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
      );
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const padded = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      // strip the 0x02 delimiter and padding
      return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
    },
  };
}

// ─────────────────────────────── VAPID keys ───────────────────────────────

function makeVapid() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** Checks a `vapid t=<jwt>,k=<key>` header: ES256 signature, audience, subject, expiry. */
function checkVapid(header: string, vapid: { publicKey: string }, origin: string) {
  const match = /^vapid t=([^,]+), ?k=(.+)$/.exec(header);
  expect(match, header).not.toBeNull();
  const [, jwt, key] = match!;
  expect(key).toBe(vapid.publicKey);
  const [head, claims, signature] = jwt!.split(".");
  const payload = JSON.parse(Buffer.from(claims!, "base64url").toString());
  expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toMatchObject({ alg: "ES256" });
  expect(payload.aud).toBe(origin);
  expect(payload.sub).toBe("mailto:reminders@pinched.test");
  expect(payload.exp * 1000).toBeGreaterThan(Date.now());
  const raw = Buffer.from(vapid.publicKey, "base64url");
  const publicKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(raw.subarray(1, 33)),
      y: b64url(raw.subarray(33, 65)),
    },
    format: "jwk",
  });
  expect(
    verifySignature(
      "sha256",
      Buffer.from(`${head}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature!, "base64url"),
    ),
    "VAPID signature",
  ).toBe(true);
}

// ─────────────────────────────── the world around the function ───────────────────────────────

let db: Db;
let dir: string;
let pushServer: https.Server;
let shimServer: http.Server;
let fn: ChildProcess;
let fnUrl: string;
let pushOrigin: string;
const vapid = makeVapid();
const devices = { ok: makeDevice(), gone: makeDevice(), flaky: makeDevice() };
const received: Captured[] = [];
let flakyMode: 503 | 201 = 503;

async function startShim(): Promise<string> {
  shimServer = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const result = await handlePostgrest(
      new Request(`http://shim.test${request.url}`, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        ...(hasBody ? { body } : {}),
      }),
      { db: db as unknown as Queryable, verifyToken: (token) => verifyJwt(token, SECRET) },
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise<void>((resolve) => shimServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(shimServer.address() as AddressInfo).port}`;
}

async function startPush(cert: string, key: string): Promise<string> {
  pushServer = https.createServer({ cert, key }, async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    received.push({
      path: request.url ?? "",
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    if (request.url === "/push/gone") response.writeHead(410).end();
    else if (request.url === "/push/flaky") response.writeHead(flakyMode).end();
    else response.writeHead(201).end();
  });
  await new Promise<void>((resolve) => pushServer.listen(0, "127.0.0.1", resolve));
  return `https://localhost:${(pushServer.address() as AddressInfo).port}`;
}

async function startFunction(env: Record<string, string>): Promise<string> {
  fn = spawn(
    DENO,
    [
      "run",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--allow-sys",
      "--config",
      "supabase/functions/send-reminders/deno.json",
      "supabase/functions/send-reminders/index.ts",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env, DENO_SERVE_ADDRESS: "tcp:127.0.0.1:0", NO_COLOR: "1" },
    },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the function did not start")), 120_000);
    const onData = (chunk: Buffer) => {
      const match = /Listening on (http:\/\/[^\s/]+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    };
    fn.stdout?.on("data", onData);
    fn.stderr?.on("data", onData);
    fn.stdout?.on(
      "data",
      (chunk: Buffer) => process.env.EDGE_DEBUG && console.log("[fn]", chunk.toString()),
    );
    fn.stderr?.on(
      "data",
      (chunk: Buffer) => process.env.EDGE_DEBUG && console.log("[fn!]", chunk.toString()),
    );
    fn.on("exit", (code) => reject(new Error(`the function exited early (${code})`)));
  });
}

const call = (headers: Record<string, string> = {}, method = "POST") =>
  fetch(fnUrl, { method, headers });
const run = async () => {
  const response = await call({ authorization: `Bearer ${CRON_SECRET}` });
  return { status: response.status, body: (await response.json()) as Record<string, number> };
};

const sql = (statement: string) => asService(db, (tx) => tx.exec(statement));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!available)("send-reminders under Deno", () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinched-edge-"));
    const key = path.join(dir, "key.pem");
    const cert = path.join(dir, "cert.pem");
    spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );

    db = await createTestDb();
    const supabaseUrl = await startShim();
    pushOrigin = await startPush(fs.readFileSync(cert, "utf8"), fs.readFileSync(key, "utf8"));

    // A Pro person whose dinner reminder is due right now (UTC), with three devices.
    const now = new Date();
    const minutes = Math.max(0, now.getUTCHours() * 60 + now.getUTCMinutes() - 1);
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const today = now.toISOString().slice(0, 10);
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
    const week = monday.toISOString().slice(0, 10);

    await sql(`
      insert into profiles (user_id, email, timezone, reminder_time, remind_prep, remind_dinner)
        values ('user_edge', 'edge@example.test', 'UTC', '${time}', false, true);
      insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end)
        values ('user_edge', 'sub_edge', 'cus_edge', 'active', now() + interval '20 days');
      insert into recipes (id, source, title, owner_id) values ('${uid(1)}', 'manual', 'Lentil Soup', 'user_edge');
      insert into saved_recipes (id, user_id, recipe_id) values ('${uid(2)}', 'user_edge', '${uid(1)}');
      insert into weekly_plans (id, user_id, week_start_date) values ('${uid(3)}', 'user_edge', '${week}');
      insert into planned_meals (id, user_id, weekly_plan_id, saved_recipe_id, planned_date, meal_type, servings)
        values ('${uid(4)}', 'user_edge', '${uid(3)}', '${uid(2)}', '${today}', 'dinner', 2);
    `);
    for (const [name, device] of Object.entries(devices)) {
      await sql(`insert into push_subscriptions (user_id, endpoint, keys) values
        ('user_edge', '${pushOrigin}/push/${name}', '{"p256dh":"${device.p256dh}","auth":"${device.auth}"}'::jsonb)`);
    }

    fnUrl = await startFunction({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: signJwt({ role: "service_role" }, SECRET, 3600),
      REMINDERS_CRON_SECRET: CRON_SECRET,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:reminders@pinched.test",
      // Trust the fake push service's certificate (Deno's own fetch and its Node-compatible https).
      DENO_CERT: cert,
      NODE_EXTRA_CA_CERTS: cert,
    });
  }, 180_000);

  afterAll(async () => {
    fn?.kill();
    await new Promise<void>((resolve) =>
      pushServer ? pushServer.close(() => resolve()) : resolve(),
    );
    await new Promise<void>((resolve) =>
      shimServer ? shimServer.close(() => resolve()) : resolve(),
    );
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("only answers POSTs that carry the shared secret", async () => {
    expect((await call({}, "GET")).status).toBe(405);
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${CRON_SECRET}x` })).status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it("sends a signed, encrypted notification that only the device can read", async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    // Three devices: delivered to two, one gone (410), one failing (503) — one person notified.
    expect(body).toMatchObject({ recipients: 1, due: 1, sent: 1, removedDevices: 1 });

    const toOk = received.find((r) => r.path === "/push/ok")!;
    expect(toOk).toBeDefined();
    expect(toOk.headers["content-encoding"]).toBe("aes128gcm");
    expect(toOk.headers.ttl).toBe("7200");
    expect(toOk.headers.topic).toBe("tonights-dinner");
    expect(toOk.headers.urgency).toBe("normal");
    checkVapid(toOk.headers.authorization as string, vapid, new URL(pushOrigin).origin);

    // The body is ciphertext — the notification text isn't readable in transit…
    expect(toOk.body.toString("utf8")).not.toContain("Lentil");
    // …but the device decrypts it.
    expect(JSON.parse(devices.ok.decrypt(toOk.body))).toEqual({
      title: "Tonight's dinner",
      body: "Lentil Soup",
      url: `/cook/${uid(4)}`,
      tag: "tonights-dinner",
    });
    // Each device gets its own encryption: the same bytes are useless to another device.
    const toFlaky = received.find((r) => r.path === "/push/flaky")!;
    expect(() => devices.ok.decrypt(toFlaky.body)).toThrow();
  });

  it("forgets a device the push service says is gone, and keeps the others", async () => {
    const left = (
      await asService(db, (tx) =>
        tx.query<{ endpoint: string }>("select endpoint from push_subscriptions order by endpoint"),
      )
    ).rows.map((row) => row.endpoint.replace(pushOrigin, ""));
    expect(left).toEqual(["/push/flaky", "/push/ok"]);
  });

  it("never sends the same reminder twice in a day", async () => {
    const before = received.length;
    const { body } = await run();
    expect(body).toMatchObject({ already: 1, sent: 0 });
    expect(received).toHaveLength(before);
  });

  it("retries later when every device fails for now, and stops once one gets it", async () => {
    // A fresh day: forget today's delivery, and make the only remaining good device fail too.
    await sql("delete from push_deliveries");
    await sql(`delete from push_subscriptions where endpoint like '%/push/ok'`);
    received.length = 0;

    const failing = await run();
    expect(failing.body).toMatchObject({ sent: 0, retrying: 1 });
    // The slot was given back, so the next run tries again…
    flakyMode = 201;
    const recovered = await run();
    expect(recovered.body).toMatchObject({ sent: 1, retrying: 0 });
    // …and then it is done for the day.
    const done = await run();
    expect(done.body).toMatchObject({ sent: 0, already: 1 });
    expect(received.filter((r) => r.path === "/push/flaky")).toHaveLength(2);
  });
});
