import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { authMode } from "@/lib/auth/config";
import { SIGN_IN } from "@/lib/routes";

import { LOCAL_SESSION_COOKIE, readLocalToken } from "./local/session";

export type Session = {
  /** The Clerk user id (or the local-mode id). Always taken from the verified session, never from input. */
  userId: string;
  /** A token Supabase accepts: Clerk's session token (role "authenticated"), or the local HS256 token. */
  getToken: () => Promise<string | null>;
  /** Display details, fetched lazily (Clerk) — only needed to create the profile row. */
  identity: () => Promise<{ email: string | null; name: string | null }>;
};

/** The signed-in user for this request, or null. Memoised per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const mode = authMode();

  if (mode === "clerk") {
    const { userId, getToken } = await auth();
    if (!userId) return null;
    return {
      userId,
      getToken: () => getToken(),
      identity: async () => {
        const user = await currentUser();
        return {
          email: user?.primaryEmailAddress?.emailAddress ?? null,
          name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null,
        };
      },
    };
  }

  if (mode === "local") {
    const jar = await cookies();
    const local = readLocalToken(jar.get(LOCAL_SESSION_COOKIE)?.value);
    if (!local) return null;
    return {
      userId: local.userId,
      getToken: async () => local.token,
      identity: async () => ({ email: local.email || null, name: local.name }),
    };
  }

  return null;
});

/** For pages and actions that need a user: sends everyone else to sign in. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(SIGN_IN);
  return session;
}
