import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";

import { cleanProps, optedOut, type EventName, type EventProps } from "@/lib/analytics/events";

/**
 * Server-side product analytics (PostHog's capture API). No client SDK, no cookies, no autocapture:
 * events are recorded where they happen, keyed by the opaque user id, and only the properties in
 * `EventProps` are sent. Off unless POSTHOG_KEY is set; skipped for people sending Global Privacy
 * Control or Do Not Track. Never throws and never slows a request down — the send runs after the
 * response, and a failure is ignored.
 */

const DEFAULT_HOST = "https://us.i.posthog.com";

function config(): { key: string; host: string } | null {
  const key = process.env.POSTHOG_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST;
  return { key, host: host.replace(/\/$/, "") };
}

/** The request's headers when there is one (webhooks and jobs have no person behind the request). */
async function requestHeaders(): Promise<{ get(name: string): string | null } | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

export async function track<E extends EventName>(
  userId: string,
  event: E,
  props: EventProps[E],
): Promise<void> {
  try {
    const target = config();
    if (!target || !userId) return;
    const incoming = await requestHeaders();
    if (incoming && optedOut(incoming)) return;

    const body = JSON.stringify({
      api_key: target.key,
      event,
      distinct_id: userId,
      timestamp: new Date().toISOString(),
      properties: {
        ...cleanProps(props),
        $lib: "pinched-server",
        // Anonymous events: no person profile is created for anyone.
        $process_person_profile: false,
      },
    });
    const send = async () => {
      try {
        await fetch(`${target.host}/capture/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // analytics must never break the product
      }
    };
    try {
      after(send);
    } catch {
      // not inside a request (a script or a test): just send it
      await send();
    }
  } catch {
    // never throw from analytics
  }
}
