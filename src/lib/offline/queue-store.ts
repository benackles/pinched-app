/**
 * A small external store over the offline queue, for the UI. IndexedDB is asynchronous, so the
 * latest entries per person are mirrored in memory and refreshed whenever the queue changes — in
 * this tab or another. React binds to it in `use-queue.ts`; it lives here, free of React, so the
 * behaviour can be tested.
 */
import { listQueue, onQueueChange, type QueueEntry } from "./queue";

const EMPTY: QueueEntry[] = [];
const mirror = new Map<string, QueueEntry[]>();
/** Who is being watched, and by which listeners. */
const watchers = new Map<string, Set<() => void>>();
let stopListening: (() => void) | null = null;

const same = (a: QueueEntry[], b: QueueEntry[]) =>
  a.length === b.length &&
  a.every((entry, i) => entry.id === b[i]!.id && entry.value === b[i]!.value);

async function refresh(userId: string) {
  const entries = await listQueue(userId);
  if (same(mirror.get(userId) ?? EMPTY, entries)) return;
  mirror.set(userId, entries.length ? entries : EMPTY);
  watchers.get(userId)?.forEach((callback) => callback());
}

/**
 * Calls `callback` whenever the person's pending changes differ from before. Returns the
 * unsubscribe function. The first change ever made (queue empty before) is announced too.
 */
export function subscribeToQueue(userId: string, callback: () => void): () => void {
  const listeners = watchers.get(userId) ?? new Set<() => void>();
  listeners.add(callback);
  watchers.set(userId, listeners);
  // One listener serves everyone being watched: any queue change refreshes each of them.
  stopListening ??= onQueueChange(() => watchers.forEach((_, id) => void refresh(id)));
  void refresh(userId);
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) watchers.delete(userId);
    if (watchers.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}

/** The person's pending changes (a stable reference until something changes). */
export function queueSnapshot(userId: string): QueueEntry[] {
  return mirror.get(userId) ?? EMPTY;
}

/** Test hook: forget everything the store has cached. */
export function resetQueueStoreForTests() {
  mirror.clear();
  watchers.clear();
  stopListening?.();
  stopListening = null;
}
