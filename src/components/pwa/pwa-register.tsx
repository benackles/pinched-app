"use client";

import { useEffect } from "react";

import { registerOrCleanupServiceWorker } from "@/lib/pwa/sw-client";

/** Registers the service worker (production + canonical domain only). Renders nothing. */
export function PwaRegister() {
  useEffect(() => {
    void registerOrCleanupServiceWorker();
  }, []);
  return null;
}
