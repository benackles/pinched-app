/**
 * Supabase Edge Function: push reminders (prep-day and tonight's dinner).
 *
 * Invoked every few minutes by pg_cron (see supabase/cron/send-reminders.sql) with
 * `Authorization: Bearer <REMINDERS_CRON_SECRET>`. Deployed with --no-verify-jwt (see
 * supabase/config.toml): the shared secret is the only way in.
 *
 * Secrets: REMINDERS_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (mailto: or https: contact). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.
 */
import { createClient } from "@supabase/supabase-js";
import webpush from "npm:web-push@3.6.7";

import { runReminders, type Sender } from "./core.ts";

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
    secret = need("REMINDERS_CRON_SECRET");
  } catch {
    return json({ error: "not configured" }, 500);
  }
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, secret)) return json({ error: "unauthorized" }, 401);

  try {
    webpush.setVapidDetails(
      need("VAPID_SUBJECT"),
      need("VAPID_PUBLIC_KEY"),
      need("VAPID_PRIVATE_KEY"),
    );
    const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const send: Sender = async (target, message) => {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: target.keys },
          JSON.stringify(message),
          // Worthless a couple of hours late; `topic` replaces an earlier unread one of the same kind.
          { TTL: 2 * 60 * 60, urgency: "normal", topic: message.tag },
        );
        return { ok: true };
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        const gone = status === 404 || status === 410;
        const retryable = !gone && (status === undefined || status === 429 || status >= 500);
        // What the push service said — never the payload, the keys or the full endpoint.
        console.warn(
          `push to ${new URL(target.endpoint).host} failed:`,
          status ?? "no response",
          error instanceof Error ? error.message.slice(0, 200) : "",
        );
        return { ok: false, gone, retryable, status };
      }
    };

    const summary = await runReminders({ admin, send });
    return json(summary);
  } catch (error) {
    console.error("send-reminders failed:", error instanceof Error ? error.message : error);
    return json({ error: "failed" }, 500);
  }
});
