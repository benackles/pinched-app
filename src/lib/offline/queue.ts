/**
 * The offline check-off queue (PRD → Offline boundaries).
 *
 * Checking off a grocery item or ticking a prep task while offline is the one write that works
 * without a connection: it is stored in IndexedDB and replayed when the connection returns.
 * It lives in the app, not in the service worker's background sync, so every replay is made by
 * the page with the person's CURRENT session — a fresh Clerk token that still passes RLS.
 *
 * Last write wins per item: each entry carries the client's timestamp, only the latest toggle of
 * an item is kept, and the server applies it only if the row hasn't been written more recently.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type QueuedMutation =
  | { kind: "grocery.check"; targetId: string; value: boolean }
  | { kind: "prep.complete"; targetId: string; value: boolean };

export type QueueEntry = QueuedMutation & {
  id: number;
  /** Whose session made the change — one person's queue never replays under another's. */
  userId: string;
  /** Client clock (ms) when the change was made. */
  at: number;
};

type Stored = Omit<QueueEntry, "id"> & { id?: number };

interface QueueDB extends DBSchema {
  mutations: { key: number; value: Stored; indexes: { "by-user": string } };
}

const DB_NAME = "pinched-offline";
const STORE = "mutations";
const CHANNEL = "pinched-queue";

let dbPromise: Promise<IDBPDatabase<QueueDB> | null> | null = null;
/** Used when IndexedDB is unavailable (some private modes) — changes then live only until reload. */
const memory: QueueEntry[] = [];
let memorySeq = 0;

function getDb() {
  dbPromise ??= openDB<QueueDB>(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("by-user", "userId");
    },
  }).catch(() => null);
  return dbPromise;
}

/** Test hook: forget the cached connection so a fresh fake database can be used. */
export function resetQueueForTests() {
  dbPromise = null;
  memory.length = 0;
  memorySeq = 0;
}

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function notify() {
  listeners.forEach((listener) => listener());
  try {
    channel ??= typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channel?.postMessage("changed");
  } catch {
    // another tab simply won't hear about it until it next reads
  }
}

/** Subscribe to queue changes made in this tab or any other. Returns an unsubscribe function. */
export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  let remote: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      remote = new BroadcastChannel(CHANNEL);
      remote.onmessage = () => listener();
    }
  } catch {
    remote = null;
  }
  return () => {
    listeners.delete(listener);
    remote?.close();
  };
}

const sameTarget = (a: QueuedMutation, b: QueuedMutation) =>
  a.kind === b.kind && a.targetId === b.targetId;

/** Adds a change. An earlier, still-pending change to the same item is replaced (last write wins). */
export async function enqueue(userId: string, mutation: QueuedMutation, at = Date.now()) {
  const db = await getDb();
  if (!db) {
    for (let i = memory.length - 1; i >= 0; i--) {
      const entry = memory[i]!;
      if (entry.userId === userId && sameTarget(entry, mutation)) memory.splice(i, 1);
    }
    memory.push({ ...mutation, id: ++memorySeq, userId, at });
    notify();
    return;
  }
  const tx = db.transaction(STORE, "readwrite");
  const existing = await tx.store.index("by-user").getAll(userId);
  for (const entry of existing) {
    if (sameTarget(entry, mutation) && entry.id !== undefined) await tx.store.delete(entry.id);
  }
  await tx.store.add({ ...mutation, userId, at });
  await tx.done;
  notify();
}

export async function listQueue(userId: string): Promise<QueueEntry[]> {
  const db = await getDb();
  if (!db) return memory.filter((entry) => entry.userId === userId);
  const rows = await db.getAllFromIndex(STORE, "by-user", userId);
  return (rows as QueueEntry[]).sort((a, b) => a.id - b.id);
}

export async function queueSize(userId: string): Promise<number> {
  return (await listQueue(userId)).length;
}

async function remove(id: number) {
  const db = await getDb();
  if (!db) {
    const index = memory.findIndex((entry) => entry.id === id);
    if (index !== -1) memory.splice(index, 1);
    return;
  }
  await db.delete(STORE, id);
}

/** Forget everything queued (on sign-out, or for one person). */
export async function clearQueue(userId?: string) {
  const db = await getDb();
  if (!db) {
    for (let i = memory.length - 1; i >= 0; i--) {
      if (!userId || memory[i]!.userId === userId) memory.splice(i, 1);
    }
  } else if (userId) {
    const tx = db.transaction(STORE, "readwrite");
    for (const entry of await tx.store.index("by-user").getAll(userId)) {
      if (entry.id !== undefined) await tx.store.delete(entry.id);
    }
    await tx.done;
  } else {
    await db.clear(STORE);
  }
  notify();
}

/**
 * The latest pending value for each item — apply this over server data so a reload while offline
 * still shows what the person just checked off.
 */
export function pendingValues(
  entries: QueueEntry[],
  kind: QueuedMutation["kind"],
): Map<string, boolean> {
  const values = new Map<string, boolean>();
  for (const entry of entries) if (entry.kind === kind) values.set(entry.targetId, entry.value);
  return values;
}

/** How a replay went: `done` and `drop` remove the entry; `retry` keeps it and stops (connection trouble). */
export type ReplayOutcome = "done" | "drop" | "retry";

let flushing: Promise<FlushResult> | null = null;
export type FlushResult = { done: number; dropped: number; remaining: number; skipped?: boolean };

async function runFlush(
  userId: string,
  replay: (entry: QueueEntry) => Promise<ReplayOutcome>,
): Promise<FlushResult> {
  const entries = await listQueue(userId);
  let done = 0;
  let dropped = 0;
  for (const entry of entries) {
    const outcome = await replay(entry);
    if (outcome === "retry") break;
    await remove(entry.id);
    if (outcome === "done") done++;
    else dropped++;
  }
  if (done || dropped) notify();
  return { done, dropped, remaining: await queueSize(userId) };
}

/**
 * Replays the queue in order. Only one flush runs at a time — across tabs too when the Web Locks
 * API exists — so a change is never sent twice.
 */
export function flushQueue(
  userId: string,
  replay: (entry: QueueEntry) => Promise<ReplayOutcome>,
): Promise<FlushResult> {
  if (flushing) return flushing;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const task = locks
    ? locks.request(`pinched-queue-flush:${userId}`, { ifAvailable: true }, async (lock) =>
        lock
          ? runFlush(userId, replay)
          : ({ done: 0, dropped: 0, remaining: -1, skipped: true } as FlushResult),
      )
    : runFlush(userId, replay);
  flushing = Promise.resolve(task).finally(() => {
    flushing = null;
  });
  return flushing;
}
