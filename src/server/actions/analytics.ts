"use server";

import { clientEventSchema, type ClientEvent } from "@/lib/analytics/events";
import { requireSession } from "@/server/auth";
import { track } from "@/server/analytics";

/**
 * The few events only the browser can see (install prompt, launched as an installed app). The
 * person comes from the session, the event from a fixed list, and failures are swallowed —
 * analytics never shows an error.
 */
export async function trackClientEvent(input: ClientEvent): Promise<void> {
  try {
    const parsed = clientEventSchema.parse(input);
    const session = await requireSession();
    switch (parsed.event) {
      case "install_prompt_shown":
      case "pwa_opened":
        await track(session.userId, parsed.event, { platform: parsed.platform });
        break;
      case "install_accepted":
      case "install_dismissed":
        await track(session.userId, parsed.event, {});
        break;
    }
  } catch {
    // ignored on purpose
  }
}
