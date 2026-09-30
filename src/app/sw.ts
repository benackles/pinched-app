/// <reference lib="webworker" />
/**
 * Pinched service worker (Serwist).
 *
 * Caching table (PRD → "Service worker and caching"):
 *   build output + public assets ........ precache on install (files up to 6MB)
 *   page navigations .................... NetworkFirst, 4s network timeout, then the cached page
 *   Supabase data reads (GET /rest/v1/*)  NetworkFirst, 14-day expiry
 *   recipe + user photos (Storage) ...... CacheFirst, size-capped
 *   auth, import, Stripe, API routes .... never cached
 *
 * Fonts are self-hosted through next/font, so they are part of the precached build output;
 * the PRD's StaleWhileRevalidate rule for fonts.googleapis.com is deliberately absent because
 * nothing in the app loads Google Fonts directly.
 */
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Cache names. "pages" and "pages-rsc" match the names @serwist/next's cacheOnNavigation
 * helper writes to, so pages opened through client-side navigation are found offline too.
 */
const CACHE = {
  pages: "pages",
  pagesRsc: "pages-rsc",
  data: "pinched-data",
  media: "pinched-media",
  startUrl: "start-url",
  meta: "pinched-meta",
} as const;

/** Everything in these caches belongs to one signed-in user. */
const USER_SCOPED_CACHES = [CACHE.pages, CACHE.pagesRsc, CACHE.data, CACHE.media, CACHE.startUrl];

/** Paths that must never be served from or written to a cache. */
const NEVER_CACHE = /^\/(?:api|sign-in|sign-up|sign-out|_clerk|~offline)(?:\/|$)/;

const SW_TIMEOUT_SECONDS = 4;
const FOURTEEN_DAYS = 60 * 60 * 24 * 14;

const isCacheablePage = ({
  request,
  sameOrigin,
  url,
}: {
  request: Request;
  sameOrigin: boolean;
  url: URL;
}) =>
  sameOrigin &&
  !NEVER_CACHE.test(url.pathname) &&
  (request.mode === "navigate" || request.headers.get("x-pinched-warm") === "1");

const runtimeCaching: RuntimeCaching[] = [
  // Auth, import, Stripe and every other API route: always the network, never stored.
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && NEVER_CACHE.test(url.pathname),
    handler: new NetworkOnly(),
  },
  // Page navigations (and the post-login route warm-up): fresh online, cached copy with no signal.
  {
    matcher: isCacheablePage,
    handler: new NetworkFirst({
      cacheName: CACHE.pages,
      networkTimeoutSeconds: SW_TIMEOUT_SECONDS,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 50, purgeOnQuotaError: true }),
      ],
    }),
  },
  // Client-side route transitions (RSC payloads). Prefetches are partial, so they are skipped.
  {
    matcher: ({ request, sameOrigin, url }) =>
      sameOrigin &&
      !NEVER_CACHE.test(url.pathname) &&
      request.headers.get("RSC") === "1" &&
      request.headers.get("Next-Router-Prefetch") !== "1",
    handler: new NetworkFirst({
      cacheName: CACHE.pagesRsc,
      networkTimeoutSeconds: SW_TIMEOUT_SECONDS,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 50, purgeOnQuotaError: true }),
      ],
    }),
  },
  // Supabase REST reads: the last-seen week, kitchen, recipes and prep list stay readable.
  {
    matcher: ({ request, url }) => request.method === "GET" && url.pathname.startsWith("/rest/v1/"),
    method: "GET",
    handler: new NetworkFirst({
      cacheName: CACHE.data,
      networkTimeoutSeconds: SW_TIMEOUT_SECONDS,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 300,
          maxAgeSeconds: FOURTEEN_DAYS,
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // Recipe and user photos: cache-first so meal cards keep their images offline.
  // Signed URLs change their token every hour, so the cache key ignores the query string.
  {
    matcher: ({ request, url }) =>
      request.method === "GET" &&
      (url.pathname.includes("/storage/v1/object/") || url.pathname.startsWith("/api/local/storage/")) &&
      request.destination !== "document",
    method: "GET",
    handler: new CacheFirst({
      cacheName: CACHE.media,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true }),
        {
          cacheKeyWillBeUsed: async ({ request }) => {
            const url = new URL(request.url);
            url.search = "";
            return url.toString();
          },
        },
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A new deploy activates as soon as it ships.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// --- Per-user cache hygiene -------------------------------------------------------------
// The caches above hold one person's week, kitchen and recipes. They are purged when the
// signed-in user changes or signs out, so a shared phone never shows the previous account.

async function clearUserCaches() {
  await Promise.all(USER_SCOPED_CACHES.map((name) => caches.delete(name)));
}

async function syncSession(userId: string | null) {
  const meta = await caches.open(CACHE.meta);
  const key = new Request("/__pinched/session");
  const previous = await meta.match(key).then((r) => r?.text());
  if (userId === null) {
    await clearUserCaches();
    await meta.delete(key);
    return;
  }
  if (previous !== undefined && previous !== userId) await clearUserCaches();
  if (previous !== userId) await meta.put(key, new Response(userId));
}

type PinchedMessage =
  | { type: "PINCHED_SESSION"; userId: string | null }
  | { type: "PINCHED_CLEAR_CACHES" };

self.addEventListener("message", (event) => {
  const data = event.data as PinchedMessage | undefined;
  if (!data || typeof data !== "object") return;
  if (data.type === "PINCHED_SESSION") {
    event.waitUntil(syncSession(typeof data.userId === "string" ? data.userId : null));
  } else if (data.type === "PINCHED_CLEAR_CACHES") {
    event.waitUntil(clearUserCaches());
  }
});

// --- Web Push (prep-day reminder, tonight's dinner) ---------------------------------------

type PushPayload = { title?: string; body?: string; url?: string; tag?: string };

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload | undefined) ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Pinched", {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: payload.tag,
      data: { url: payload.url ?? "/plan" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | undefined)?.url ?? "/plan", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
