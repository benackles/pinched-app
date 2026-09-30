import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_PHOTO_BYTES, mediaPath } from "@/lib/media/upload";
import {
  handleLocalObject,
  handleLocalUpload,
  localMediaStore,
  parseRange,
  signLocal,
  verifyLocal,
} from "@/server/media/local-store";

const user = "user_local_abc123";
const recipe = "3f2a9c1e-5b7d-4e8a-9c6b-1a2b3c4d5e6f";
const fileId = () => crypto.randomUUID();
const ORIGIN = "http://localhost:3000";

let dir: string;
const saved = { ...process.env };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinched-media-"));
  process.env.PINCHED_LOCAL_DIR = dir;
  process.env.PINCHED_LOCAL_SECRET = "test-secret-for-media";
});
afterAll(() => {
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (url: string, body: BodyInit | null, type: string) =>
  new Request(`${ORIGIN}${url}`, {
    method: "PUT",
    body,
    headers: { "content-type": type },
    // Node needs this to send a streamed body
    ...(body && typeof body !== "string" ? { duplex: "half" } : {}),
  } as RequestInit);

const pathOf = (url: string) => new URL(`${ORIGIN}${url}`).pathname.split("/").slice(5).join("/");

describe("signed tokens", () => {
  it("are bound to one purpose, one object and an expiry", () => {
    const p = mediaPath(user, recipe, fileId(), "jpg");
    const token = signLocal("get", p, 60);
    expect(verifyLocal("get", p, token)).toBe(true);
    expect(verifyLocal("put", p, token)).toBe(false);
    expect(verifyLocal("get", mediaPath(user, recipe, fileId(), "jpg"), token)).toBe(false);
    expect(verifyLocal("get", p, null)).toBe(false);
    expect(verifyLocal("get", p, "nonsense")).toBe(false);
    expect(verifyLocal("get", p, `${token}x`)).toBe(false);
    // expired: verify a minute and a bit later
    expect(verifyLocal("get", p, token, Date.now() + 61_000)).toBe(false);
    // a forged expiry with a valid-looking signature from another expiry
    const [, sig] = token.split(".");
    expect(verifyLocal("get", p, `9999999999.${sig}`)).toBe(false);
  });
});

describe("local media store", () => {
  const store = localMediaStore();

  async function upload(p: string, body: Uint8Array, type: string) {
    const ticket = await store.createUpload(p, type);
    expect(ticket.method).toBe("PUT");
    const response = await handleLocalUpload(
      put(ticket.url, Buffer.from(body), type),
      pathOf(ticket.url),
    );
    return { ticket, response };
  }

  it("uploads, reports, signs, serves and removes a photo", async () => {
    const p = mediaPath(user, recipe, fileId(), "jpg");
    const bytes = Uint8Array.from({ length: 2000 }, (_, i) => i % 251);
    expect(await store.info(p)).toBeNull();

    const { response } = await upload(p, bytes, "image/jpeg");
    expect(response.status).toBe(200);
    expect(await store.info(p)).toEqual({ size: 2000, contentType: "image/jpeg" });

    const signed = (await store.sign([p, "nope/not/ours"])).get(p)!;
    expect(signed).toContain("/api/local/storage/object/");
    const read = await handleLocalObject(new Request(`${ORIGIN}${signed}`), p);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/jpeg");
    expect(read.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);

    await store.remove([p]);
    expect(await store.info(p)).toBeNull();
    expect((await store.sign([p])).size).toBe(0);
  });

  it("serves byte ranges for video", async () => {
    const p = mediaPath(user, recipe, fileId(), "mp4");
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    await upload(p, bytes, "video/mp4");
    const url = `${ORIGIN}${(await store.sign([p])).get(p)!}`;

    const part = await handleLocalObject(
      new Request(url, { headers: { range: "bytes=10-19" } }),
      p,
    );
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(part.headers.get("content-length")).toBe("10");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(10, 20));

    const tail = await handleLocalObject(new Request(url, { headers: { range: "bytes=-5" } }), p);
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(995));

    const beyond = await handleLocalObject(
      new Request(url, { headers: { range: "bytes=5000-" } }),
      p,
    );
    expect(beyond.status).toBe(416);

    const head = await handleLocalObject(new Request(url, { method: "HEAD" }), p);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("1000");
  });

  it("refuses an upload with the wrong token, the wrong type, or over the limit", async () => {
    const p = mediaPath(user, recipe, fileId(), "png");
    const ticket = await store.createUpload(p, "image/png");
    const objectPath = pathOf(ticket.url);

    // token for a different object
    const other = mediaPath(user, recipe, fileId(), "png");
    const stolen = `/api/local/storage/upload/${objectPath}?token=${signLocal("put", other, 60)}`;
    expect(
      (await handleLocalUpload(put(stolen, Buffer.from("x"), "image/png"), objectPath)).status,
    ).toBe(403);

    // a read token must not open an upload
    const readToken = `/api/local/storage/upload/${objectPath}?token=${signLocal("get", p, 60)}`;
    expect(
      (await handleLocalUpload(put(readToken, Buffer.from("x"), "image/png"), objectPath)).status,
    ).toBe(403);

    // type must match the path's extension
    expect(
      (await handleLocalUpload(put(ticket.url, Buffer.from("x"), "text/html"), objectPath)).status,
    ).toBe(415);

    // over the photo limit
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1, 1);
    expect((await handleLocalUpload(put(ticket.url, big, "image/png"), objectPath)).status).toBe(
      413,
    );
    // …and nothing is left behind, not even a partial file
    expect(await store.info(p)).toBeNull();
    const folder = path.join(dir, "storage", user, recipe);
    const leftovers = fs.existsSync(folder)
      ? fs.readdirSync(folder).filter((f) => f.includes(p.split("/").pop()!))
      : [];
    expect(leftovers).toEqual([]);

    // empty
    expect(
      (await handleLocalUpload(put(ticket.url, Buffer.alloc(0), "image/png"), objectPath)).status,
    ).toBe(400);
  });

  it("never overwrites an existing object", async () => {
    const p = mediaPath(user, recipe, fileId(), "webp");
    const first = await upload(p, Uint8Array.from([1, 2, 3]), "image/webp");
    expect(first.response.status).toBe(200);
    const second = await upload(p, Uint8Array.from([9, 9, 9]), "image/webp");
    expect(second.response.status).toBe(409);
    const read = await handleLocalObject(
      new Request(`${ORIGIN}${(await store.sign([p])).get(p)!}`),
      p,
    );
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it("rejects paths that are not exactly our shape", async () => {
    for (const bad of [
      "../../etc/passwd",
      `${user}/../${recipe}/${fileId()}.jpg`,
      "a/b/c.jpg",
      "",
    ]) {
      const token = signLocal("get", bad, 60);
      const response = await handleLocalObject(new Request(`${ORIGIN}/x?token=${token}`), bad);
      expect(response.status, bad).toBe(400);
      await expect(store.createUpload(bad, "image/jpeg")).rejects.toThrow();
    }
  });

  it("answers 404 for a signed link to a missing file", async () => {
    const p = mediaPath(user, recipe, fileId(), "jpg");
    const url = `${ORIGIN}/x?token=${signLocal("get", p, 60)}`;
    expect((await handleLocalObject(new Request(url), p)).status).toBe(404);
  });
});

describe("parseRange", () => {
  it("handles the forms browsers send", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-20", 100)).toEqual({ start: 10, end: 20 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=20-10", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    // unsupported shapes are served whole
    expect(parseRange("bytes=0-1,5-9", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
  });
});
