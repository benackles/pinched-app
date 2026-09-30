/**
 * The orphaned-upload sweep, with its I/O injected: a service-role Supabase client and a function
 * that removes files from Storage. The Edge Function (index.ts) wires in the real ones; the tests
 * wire in a double.
 *
 * What counts as an orphan is decided in the database (`orphaned_media_objects()`): a file in the
 * recipe-media bucket, older than the grace period, that no `recipe_media` row points at. The
 * grace period is what keeps an upload that is still on its way to being attached safe.
 *
 * Guarantees:
 *  - files are removed through the Storage API (deleting `storage.objects` rows would leave the
 *    bytes behind), in small batches
 *  - a batch Storage refuses is reported and left for the next run; the others still go
 *  - it always terminates: it stops when nothing is left, when a round removed nothing, or after
 *    `maxRounds` (so one run stays well inside the function's time limit)
 *  - the summary holds counts only — never file names, which contain people's ids
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Removes the named files and says how many Storage actually deleted. Throws if it refuses. */
export type Remover = (names: string[]) => Promise<number>;

export type Summary = {
  /** Orphaned files the database listed. */
  found: number;
  /** Files Storage deleted. */
  removed: number;
  /** Files in batches Storage refused; the next run tries them again. */
  failed: number;
  /** Times the database was asked. */
  rounds: number;
  /** More were waiting when this run stopped (round limit, or a round that made no progress). */
  more: boolean;
};

/** The bucket the orphan query looks at; kept here so the job and its tests agree on it. */
export const MEDIA_BUCKET = "recipe-media";

/** Files younger than this are never touched: an upload may still be waiting to be attached. */
export const DEFAULT_MIN_AGE = "1 day";

const BATCH = 100;
const DEFAULT_MAX_ROUNDS = 20;

type Admin = SupabaseClient;

export async function runCleanup(deps: {
  admin: Admin;
  remove: Remover;
  /** A Postgres interval, e.g. "1 day". */
  minAge?: string;
  maxRounds?: number;
}): Promise<Summary> {
  const { admin, remove } = deps;
  const minAge = deps.minAge ?? DEFAULT_MIN_AGE;
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const summary: Summary = { found: 0, removed: 0, failed: 0, rounds: 0, more: false };

  while (summary.rounds < maxRounds) {
    const listed = await admin.rpc("orphaned_media_objects", { p_min_age: minAge });
    if (listed.error) throw new Error(`list orphans: ${listed.error.message}`);
    const names = ((listed.data ?? []) as { name?: unknown }[]).map((row) => row.name);
    // Never hand Storage anything but real names: a changed response shape must stop the job.
    if (!names.every((name): name is string => typeof name === "string" && name !== "")) {
      throw new Error("list orphans: unexpected response");
    }
    summary.rounds += 1;
    if (names.length === 0) return summary;
    summary.found += names.length;

    let removedThisRound = 0;
    let failedThisRound = 0;
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      try {
        removedThisRound += await remove(batch);
      } catch (error) {
        failedThisRound += batch.length;
        console.warn(
          `cleanup-media: removing ${batch.length} files failed:`,
          error instanceof Error ? error.message.slice(0, 200) : "",
        );
      }
    }
    summary.removed += removedThisRound;
    summary.failed += failedThisRound;

    // The same files would be listed again, so looping on would only repeat the failure.
    if (removedThisRound === 0 || failedThisRound > 0) {
      summary.more = true;
      return summary;
    }
  }

  summary.more = true;
  return summary;
}
