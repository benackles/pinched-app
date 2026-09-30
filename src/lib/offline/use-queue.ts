"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { QueueEntry } from "./queue";
import { queueSnapshot, subscribeToQueue } from "./queue-store";

/** React bindings for the offline queue (the store itself is in queue-store.ts). */

const EMPTY: QueueEntry[] = [];

/** The person's pending offline changes (stable reference until something changes). */
export function useQueueEntries(userId: string): QueueEntry[] {
  const subscribeUser = useCallback(
    (callback: () => void) => subscribeToQueue(userId, callback),
    [userId],
  );
  return useSyncExternalStore(
    subscribeUser,
    () => queueSnapshot(userId),
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
