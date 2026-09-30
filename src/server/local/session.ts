import "server-only";

import { signJwt, verifyJwt } from "./jwt";
import { localSecret } from "./secret";

export const LOCAL_SESSION_COOKIE = "pinched_local_session";
export const LOCAL_SESSION_SECONDS = 60 * 60 * 24 * 30;

export type LocalUser = { userId: string; email: string; name: string | null };

/** A stable local user id from an email address, so signing in again finds the same data. */
export function localUserId(email: string): string {
  let hash = 0;
  const normalized = email.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++)
    hash = (Math.imul(31, hash) + normalized.charCodeAt(i)) | 0;
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return `user_local_${slug}_${(hash >>> 0).toString(36)}`;
}

/** The token Supabase (the local PostgREST shim) accepts — same claims Clerk's session token carries. */
export function mintLocalToken(user: LocalUser): string {
  return signJwt(
    {
      sub: user.userId,
      role: "authenticated",
      aud: "authenticated",
      email: user.email,
      name: user.name,
    },
    localSecret(),
    LOCAL_SESSION_SECONDS,
  );
}

/** Stand-in for Supabase's anon key: itself a JWT (role "anon"), sent when nobody is signed in. */
export function mintAnonKey(): string {
  return signJwt({ role: "anon", iss: "pinched-local" }, localSecret(), 60 * 60 * 24 * 365);
}

export function mintServiceToken(): string {
  return signJwt({ role: "service_role", iss: "pinched-local" }, localSecret(), 60 * 10);
}

export function readLocalToken(
  token: string | undefined | null,
): (LocalUser & { token: string }) | null {
  if (!token) return null;
  const claims = verifyJwt(token, localSecret());
  if (!claims || claims === "expired") return null;
  if (claims.role !== "authenticated" || typeof claims.sub !== "string") return null;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    name: typeof claims.name === "string" ? claims.name : null,
    token,
  };
}
