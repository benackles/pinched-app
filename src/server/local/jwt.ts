import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Claims } from "./postgrest/handler";

const b64 = (input: string | Buffer) => Buffer.from(input).toString("base64url");

const sign = (data: string, secret: string) =>
  createHmac("sha256", secret).update(data).digest("base64url");

/** HS256 JWT for the credential-free local mode (stands in for Clerk's session token). */
export function signJwt(
  claims: Claims,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds }));
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  now = Date.now(),
): Claims | "expired" | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const head = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: string };
    if (head.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
    if (typeof claims.exp === "number" && claims.exp * 1000 <= now) return "expired";
    return claims;
  } catch {
    return null;
  }
}
