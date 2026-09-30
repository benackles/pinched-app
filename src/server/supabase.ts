import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/types";
import { isLocalMode } from "@/lib/auth/config";

import { requireSession } from "./auth";
import { supabasePublicEnv, supabaseServiceKey } from "./env";
import { mintAnonKey, mintServiceToken } from "./local/session";

export type Supabase = SupabaseClient<Database>;

const LOCAL_URL = "http://pinched.local";

/**
 * Local mode: requests never touch the network — they go straight to the in-process PostgREST
 * shim over PGlite, using the same real supabase-js client as production.
 */
async function localFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const [{ getLocalDb }, { handlePostgrest }, { verifyJwt }, { localSecret }] = await Promise.all([
    import("./local/db"),
    import("./local/postgrest/handler"),
    import("./local/jwt"),
    import("./local/secret"),
  ]);
  const db = await getLocalDb();
  return handlePostgrest(new Request(input, init), {
    db,
    verifyToken: (token) => verifyJwt(token, localSecret()),
  });
}

/**
 * A Supabase client that acts as the signed-in user: every request carries the Clerk session
 * token, so Row Level Security (`auth.jwt()->>'sub'`) scopes it to that user's rows.
 */
export async function userClient(): Promise<Supabase> {
  const session = await requireSession();
  return clientWithToken(() => session.getToken());
}

export function clientWithToken(getToken: () => Promise<string | null>): Supabase {
  if (isLocalMode()) {
    return createClient<Database>(LOCAL_URL, mintAnonKey(), {
      accessToken: getToken,
      global: { fetch: localFetch },
    });
  }
  const { url, key } = supabasePublicEnv();
  return createClient<Database>(url, key, { accessToken: getToken });
}

/**
 * The service-role client. Bypasses RLS — only for webhooks, cron and other server jobs, and only
 * ever with a user id taken from a verified source (a Stripe/Clerk signature), never from a request body.
 */
export function adminClient(): Supabase {
  if (isLocalMode()) {
    return createClient<Database>(LOCAL_URL, mintAnonKey(), {
      accessToken: async () => mintServiceToken(),
      global: { fetch: localFetch },
    });
  }
  const { url } = supabasePublicEnv();
  return createClient<Database>(url, supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
