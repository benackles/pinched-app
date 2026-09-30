"use client";

import { setGroceryChecked } from "@/server/actions/grocery";
import { setPrepTaskCompleted } from "@/server/actions/prep";

import type { QueueEntry, ReplayOutcome } from "./queue";

/** Permanent failures: replaying again can never succeed, so the change is dropped, not retried. */
const PERMANENT = new Set(["not_found", "validation", "forbidden"]);

/**
 * Sends one queued change to the server through the same validated server actions the UI uses —
 * with the page's current session, so RLS applies exactly as for a live tap.
 */
export async function replayEntry(entry: QueueEntry): Promise<ReplayOutcome> {
  try {
    const result =
      entry.kind === "grocery.check"
        ? await setGroceryChecked({ id: entry.targetId, checked: entry.value, at: entry.at })
        : await setPrepTaskCompleted({ id: entry.targetId, completed: entry.value, at: entry.at });
    if (result.ok) return "done";
    return PERMANENT.has(result.error.code) ? "drop" : "retry";
  } catch {
    // The network dropped mid-request (or the server is unreachable): keep it and try later.
    return "retry";
  }
}
