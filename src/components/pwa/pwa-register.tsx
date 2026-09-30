"use client";

import { useEffect } from "react";

import { bindServiceWorkerToUser, registerOrCleanupServiceWorker } from "@/lib/pwa/sw-client";

/** Registers the service worker (production + canonical domain only). Renders nothing. */
export function PwaRegister() {
  useEffect(() => {
    void registerOrCleanupServiceWorker();
  }, []);
  return null;
}

/**
 * Inside the signed-in app: tells the worker who is using it (so a shared phone never shows the
 * previous person's week) and warms the main screens for offline use. Renders nothing.
 */
export function PwaSession({ userId }: { userId: string }) {
  useEffect(() => {
    void bindServiceWorkerToUser(userId);
  }, [userId]);
  return null;
}
