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

const SESSION_ACK = "PINCHED_SESSION_SYNCED";

/**
 * The worker controlling this page — waiting for it on a first visit (it installs, activates, then
 * claims the page). Null when there is none (development, an unsupported browser, registration
 * refused), so callers simply skip the work.
 */
async function controllingWorker(timeoutMs = 15_000): Promise<ServiceWorker | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const { serviceWorker } = navigator;
  // No registration at all (and none coming): don't wait for a worker that will never arrive.
  if (!(await serviceWorker.getRegistration("/")) && !serviceWorker.controller) {
    // A registration may still be in flight; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (!(await serviceWorker.getRegistration("/"))) return null;
  }
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const claimed = (async () => {
    await serviceWorker.ready; // resolves once a worker is active
    if (serviceWorker.controller) return serviceWorker.controller;
    return new Promise<ServiceWorker | null>((resolve) =>
      serviceWorker.addEventListener("controllerchange", () => resolve(serviceWorker.controller), {
        once: true,
      }),
    );
  })();
  return Promise.race([claimed, deadline]);
}

/** Tells the worker who is signed in; resolves once it has purged anyone else's caches. */
async function announceSession(worker: ServiceWorker, userId: string | null): Promise<void> {
  const acknowledged = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === SESSION_ACK) {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve();
    }, 3000);
  });
  worker.postMessage({ type: "PINCHED_SESSION", userId });
  await acknowledged;
}

/** Clears cached pages, data and photos — call on sign-out. */
export async function purgeUserCaches(): Promise<void> {
  const registration =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration("/")
      : undefined;
  registration?.active?.postMessage({ type: "PINCHED_SESSION", userId: null });
  if (typeof caches !== "undefined") {
    await Promise.all(
      SW_CACHE_NAMES.filter((n) => n !== "pinched-meta").map((n) => caches.delete(n)),
    );
  }
  try {
    // The pages are gone, so the next sign-in must warm them again.
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(WARM_KEY)) window.localStorage.removeItem(key);
    }
  } catch {
    // storage unavailable
  }
}

const MAIN_ROUTES = ["/plan", "/recipes", "/kitchen", "/grocery-list", "/prep"] as const;
const WARM_KEY = "pinched.warm.v1";
const WARM_INTERVAL_MS = 1000 * 60 * 60 * 6;

/**
 * After sign-in, fetch each main screen once (through the worker, which caches it) so the whole
 * app opens offline even if the person only ever visited one tab. At most every 6 hours.
 */
async function warmMainRoutes(userId: string): Promise<void> {
  if (!navigator.onLine) return;
  const key = `${WARM_KEY}:${userId}`;
  try {
    const last = Number(window.localStorage.getItem(key) ?? 0);
    if (Date.now() - last < WARM_INTERVAL_MS) return;
  } catch {
    // storage unavailable — warm anyway
  }
  const results = await Promise.allSettled(
    MAIN_ROUTES.map((route) =>
      fetch(route, { credentials: "same-origin", headers: { "x-pinched-warm": "1" } }),
    ),
  );
  if (results.every((r) => r.status === "fulfilled" && r.value.ok)) {
    try {
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore
    }
  }
}

/**
 * Ties the worker to the signed-in person: it drops anyone else's cached pages (a shared phone),
 * then caches the main screens so they open with no signal.
 */
export async function bindServiceWorkerToUser(userId: string): Promise<void> {
  const worker = await controllingWorker();
  if (!worker) return;
  await announceSession(worker, userId);
  await warmMainRoutes(userId);
}
