"use client";

import { SW_CACHE_NAMES, shouldRegisterServiceWorker } from "./register-guard";

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent throws
  }
}

function canonicalHost(): string | undefined {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Registers the worker when allowed; otherwise removes any stray worker and its caches. */
export async function registerOrCleanupServiceWorker(): Promise<"registered" | "skipped"> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "skipped";

  const decision = shouldRegisterServiceWorker({
    isProductionDeployment: process.env.NEXT_PUBLIC_PWA_PRODUCTION === "1",
    hostname: window.location.hostname,
    canonicalHost: canonicalHost(),
    allowLocalhost: process.env.NEXT_PUBLIC_PWA_ALLOW_LOCALHOST === "1",
    inIframe: inIframe(),
    search: window.location.search,
  });

  if (!decision.register) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith("/sw.js"))
        .map((r) => r.unregister()),
    );
    if (typeof caches !== "undefined") {
      await Promise.all(SW_CACHE_NAMES.map((name) => caches.delete(name)));
    }
    return "skipped";
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    return "registered";
  } catch (error) {
    console.warn("Service worker registration failed", error);
    return "skipped";
  }
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.active ?? null;
}

/** Tells the worker who is signed in. It purges user-scoped caches if the user changed. */
export async function syncServiceWorkerSession(userId: string | null): Promise<void> {
  (await activeWorker())?.postMessage({ type: "PINCHED_SESSION", userId });
}

/** Clears cached pages, data and photos — call on sign-out. */
export async function purgeUserCaches(): Promise<void> {
  const worker = await activeWorker();
  worker?.postMessage({ type: "PINCHED_SESSION", userId: null });
  if (typeof caches !== "undefined") {
    await Promise.all(
      SW_CACHE_NAMES.filter((n) => n !== "pinched-meta").map((n) => caches.delete(n)),
    );
  }
}

const MAIN_ROUTES = ["/plan", "/recipes", "/kitchen", "/grocery-list", "/prep"] as const;
const WARM_KEY = "pinched.warm.v1";
const WARM_INTERVAL_MS = 1000 * 60 * 60 * 6;

/**
 * After sign-in, fetch each main screen once (through the worker, which caches it) so the whole
 * app opens offline even if the person only ever visited one tab. Runs at idle, at most every 6h.
 */
export function warmMainRoutes(): void {
  if (typeof window === "undefined" || !navigator.onLine) return;
  try {
    const last = Number(window.localStorage.getItem(WARM_KEY) ?? 0);
    if (Date.now() - last < WARM_INTERVAL_MS) return;
  } catch {
    // storage unavailable — warm anyway
  }
  const run = async () => {
    if (!(await activeWorker())) return; // nothing would cache the responses
    const results = await Promise.allSettled(
      MAIN_ROUTES.map((route) =>
        fetch(route, { credentials: "same-origin", headers: { "x-pinched-warm": "1" } }),
      ),
    );
    if (results.every((r) => r.status === "fulfilled")) {
      try {
        window.localStorage.setItem(WARM_KEY, String(Date.now()));
      } catch {
        // ignore
      }
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(() => void run());
  else setTimeout(() => void run(), 2000);
}
