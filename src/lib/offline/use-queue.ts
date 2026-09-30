"use client";

import { useCallback, useSyncExternalStore } from "react";

import { listQueue, onQueueChange, type QueueEntry } from "./queue";

/**
 * React bindings for the offline queue. IndexedDB is asynchronous, so a small in-memory mirror
 * is kept per person and refreshed whenever the queue changes (in this tab or another).
 */

const EMPTY: QueueEntry[] = [];
const mirror = new Map<string, QueueEntry[]>();
const subscribers = new Set<() => void>();
let stopListening: (() => void) | null = null;

const same = (a: QueueEntry[], b: QueueEntry[]) =>
  a.length === b.length &&
  a.every((entry, i) => entry.id === b[i]!.id && entry.value === b[i]!.value);

async function refresh(userId: string) {
  const entries = await listQueue(userId);
  if (same(mirror.get(userId) ?? EMPTY, entries)) return;
  mirror.set(userId, entries.length ? entries : EMPTY);
  subscribers.forEach((callback) => callback());
}

function subscribe(userId: string, callback: () => void) {
  subscribers.add(callback);
  stopListening ??= onQueueChange(() => mirror.forEach((_, id) => void refresh(id)));
  void refresh(userId);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}

/** The person's pending offline changes (stable reference until something changes). */
export function useQueueEntries(userId: string): QueueEntry[] {
  const subscribeUser = useCallback(
    (callback: () => void) => subscribe(userId, callback),
    [userId],
  );
  return useSyncExternalStore(
    subscribeUser,
    () => mirror.get(userId) ?? EMPTY,
    () => EMPTY,
  );
}

let syncing = false;
const syncListeners = new Set<() => void>();

export function setSyncing(value: boolean) {
  if (syncing === value) return;
  syncing = value;
  syncListeners.forEach((callback) => callback());
}

/** True while queued changes are being sent. */
export function useSyncing(): boolean {
  return useSyncExternalStore(
    (callback) => {
      syncListeners.add(callback);
      return () => syncListeners.delete(callback);
    },
    () => syncing,
    () => false,
  );
}
