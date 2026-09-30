import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  contentTypeForExt,
  parseMediaPath,
} from "@/lib/media/upload";
import { localDataRoot, localSecret } from "@/server/local/secret";

import type { MediaStore } from "./store";

/**
 * Local mode's stand-in for Supabase Storage: files on disk under `.pinched-local/storage`, with
 * short-lived signed URLs, the same as production. Only ever reachable when local mode is on
 * (the route refuses otherwise), and only for paths of our exact shape — never a raw file path.
 */

export const LOCAL_STORAGE_PREFIX = "/api/local/storage";
const UPLOAD_TTL_SECONDS = 2 * 60 * 60;
const READ_TTL_SECONDS = 60 * 60;

type Purpose = "put" | "get";

function mac(purpose: Purpose, objectPath: string, exp: number): string {
  return createHmac("sha256", localSecret())
    .update(`${purpose}\n${objectPath}\n${exp}`)
    .digest("base64url");
}

/** `<expiry>.<signature>` — bound to one purpose and one object. */
export function signLocal(
  purpose: Purpose,
  objectPath: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${mac(purpose, objectPath, exp)}`;
}

export function verifyLocal(
  purpose: Purpose,
  objectPath: string,
  token: string | null,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expText, signature] = token.split(".");
  const exp = Number(expText);
  if (!Number.isInteger(exp) || !signature || exp * 1000 < now) return false;
  const expected = Buffer.from(mac(purpose, objectPath, exp));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The file for a media path, or null when the path isn't exactly ours. */
export function localObjectFile(objectPath: string): string | null {
  if (!parseMediaPath(objectPath)) return null;
  return path.join(localDataRoot(), "storage", ...objectPath.split("/"));
}

export function localMediaStore(): MediaStore {
  return {
    async createUpload(objectPath, contentType) {
      if (!localObjectFile(objectPath)) throw new Error("Invalid media path.");
      const token = signLocal("put", objectPath, UPLOAD_TTL_SECONDS);
      return {
        method: "PUT",
        url: `${LOCAL_STORAGE_PREFIX}/upload/${objectPath}?token=${token}`,
        headers: { "content-type": contentType, "x-upsert": "false" },
        encoding: "raw",
      };
    },

    async info(objectPath) {
      const file = localObjectFile(objectPath);
      const parsed = parseMediaPath(objectPath);
      if (!file || !parsed) return null;
      try {
        const stat = await fs.promises.stat(file);
        return stat.isFile() ? { size: stat.size, contentType: parsed.contentType } : null;
      } catch {
        return null;
      }
    },

    async sign(paths, expiresInSeconds = READ_TTL_SECONDS) {
      const signed = new Map<string, string>();
      for (const objectPath of paths) {
        const file = localObjectFile(objectPath);
        if (!file || !fs.existsSync(file)) continue;
        const token = signLocal("get", objectPath, expiresInSeconds);
        signed.set(objectPath, `${LOCAL_STORAGE_PREFIX}/object/${objectPath}?token=${token}`);
      }
      return signed;
    },

    async remove(paths) {
      for (const objectPath of paths) {
        const file = localObjectFile(objectPath);
        if (file) await fs.promises.rm(file, { force: true });
      }
    },
  };
}

// ─────────────────────────────── HTTP handlers (used by the route) ───────────────────────────────

const text = (status: number, message: string, headers: HeadersInit = {}) =>
  new Response(message, { status, headers: { "content-type": "text/plain", ...headers } });

function tokenOf(request: Request) {
  return new URL(request.url).searchParams.get("token");
}

/** PUT /upload/<path>?token= — stream the body to disk, enforcing type and size. */
export async function handleLocalUpload(request: Request, objectPath: string): Promise<Response> {
  const parsed = parseMediaPath(objectPath);
  const file = localObjectFile(objectPath);
  if (!parsed || !file) return text(400, "Bad path.");
  if (!verifyLocal("put", objectPath, tokenOf(request))) return text(403, "Upload link expired.");

  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== parsed.contentType) return text(415, "Unsupported media type.");

  const limit = parsed.kind === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return text(413, "Too large.");
  if (!request.body) return text(400, "Empty upload.");
  if (fs.existsSync(file)) return text(409, "Already exists.");

  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      if (received > limit) done(new Error("too-large"));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(request.body as import("node:stream/web").ReadableStream),
      counter,
      fs.createWriteStream(partial, { flags: "wx" }),
    );
    if (received === 0) throw new Error("empty");
    // `wx` semantics for the final name too: never replace an existing object.
    if (fs.existsSync(file)) throw new Error("exists");
    await fs.promises.rename(partial, file);
  } catch (error) {
    await fs.promises.rm(partial, { force: true });
    const message = error instanceof Error ? error.message : "";
    if (message === "too-large") return text(413, "Too large.");
    if (message === "empty") return text(400, "Empty upload.");
    if (message === "exists") return text(409, "Already exists.");
    return text(500, "Upload failed.");
  }
  return Response.json({ path: objectPath });
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/** A single `bytes=` range (what video elements send). Multi-range requests are served whole. */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match as unknown as [string, string, string];
  if (from === "" && to === "") return null;
  let start: number;
  let end: number;
  if (from === "") {
    // the last N bytes
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** GET/HEAD /object/<path>?token= — serve a file with Range support (Safari needs it for video). */
export async function handleLocalObject(request: Request, objectPath: string): Promise<Response> {
  const parsed = parseMediaPath(objectPath);
  const file = localObjectFile(objectPath);
  if (!parsed || !file) return text(400, "Bad path.");
  if (!verifyLocal("get", objectPath, tokenOf(request))) return text(403, "Link expired.");

  let size: number;
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return text(404, "Not found.");
    size = stat.size;
  } catch {
    return text(404, "Not found.");
  }

  const headers: Record<string, string> = {
    "content-type": contentTypeForExt(parsed.ext) ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "content-disposition": "inline",
  };
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const partial = range !== null;
  headers["content-length"] = String(size === 0 ? 0 : end - start + 1);
  if (partial) headers["content-range"] = `bytes ${start}-${end}/${size}`;

  if (request.method === "HEAD" || size === 0) {
    return new Response(null, { status: partial ? 206 : 200, headers });
  }
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, { status: partial ? 206 : 200, headers });
}
