import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/types";
import { signJwt, verifyJwt } from "@/server/local/jwt";
import { handlePostgrest, type Queryable } from "@/server/local/postgrest/handler";

import type { Db } from "./db";

const SECRET = "tests-shim-secret";

/**
 * A real supabase-js client acting as the service role, talking to a test database through the
 * in-process PostgREST shim — the way webhooks and jobs reach Supabase in production.
 */
export function serviceClient(db: Db): SupabaseClient<Database> {
  return createClient<Database>("http://shim.test", signJwt({ role: "anon" }, SECRET, 600), {
    accessToken: async () => signJwt({ role: "service_role" }, SECRET, 600),
    global: {
      fetch: (input, init) =>
        handlePostgrest(new Request(input, init), {
          db: db as unknown as Queryable,
          verifyToken: (token) => verifyJwt(token, SECRET),
        }),
    },
  });
}
