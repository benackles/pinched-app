/**
 * Supabase Edge Function: remove orphaned uploads from the recipe-media bucket.
 *
 * Invoked once a day by pg_cron (see supabase/cron/cleanup-media.sql) with
 * `Authorization: Bearer <CLEANUP_CRON_SECRET>`. Deployed with --no-verify-jwt (see
 * supabase/config.toml): the shared secret is the only way in.
 *
 * Secrets: CLEANUP_CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.
 */
import { createClient } from "@supabase/supabase-js";

import { MEDIA_BUCKET, runCleanup, type Remover } from "./core.ts";

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function need(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let secret: string;
  try {
    secret = need("CLEANUP_CRON_SECRET");
  } catch {
    return json({ error: "not configured" }, 500);
  }
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, secret)) return json({ error: "unauthorized" }, 401);

  try {
    const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const remove: Remover = async (names) => {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).remove(names);
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    };

    return json(await runCleanup({ admin, remove }));
  } catch (error) {
    console.error("cleanup-media failed:", error instanceof Error ? error.message : error);
    return json({ error: "failed" }, 500);
  }
});
