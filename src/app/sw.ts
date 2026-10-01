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
 * Cache names. Every write to the user-scoped ones below goes through `onlyWhileSignedIn`, which is
 * why @serwist/next's cacheOnNavigation helper (it writes "pages" from the page, ungated) is off.
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

/** Local demo mode serves uploaded media from here (production uses Supabase Storage). */
const LOCAL_MEDIA_PATH = "/api/local/storage/";

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

/** Where the worker remembers whose pages it is holding (see "Per-user cache hygiene" below). */
const SESSION_KEY = "/__pinched/session";

async function hasSession(): Promise<boolean> {
  return (await (await caches.open(CACHE.meta)).match(SESSION_KEY)) !== undefined;
}

/**
 * Nothing is stored for anyone who isn't signed in: a person's screens are only written to the
 * caches while the worker knows whose session it is. That also closes a race on sign-out, where a
 * request still in flight could otherwise write a page back just after the purge.
 */
const onlyWhileSignedIn = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    (await hasSession()) ? response : null,
};

/** The cached HTML of each screen — what opens when the app is launched with no signal. */
const pagesStrategy = new NetworkFirst({
  cacheName: CACHE.pages,
  networkTimeoutSeconds: SW_TIMEOUT_SECONDS,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
    onlyWhileSignedIn,
    new ExpirationPlugin({ maxEntries: 50, purgeOnQuotaError: true }),
  ],
});

// The app renders on the server, so a screen's cached HTML is only as fresh as the last time it was
// fetched as a document. People mostly move around by client-side navigation and save changes through
// Server Actions, neither of which refetches the HTML. So whenever the app talks to the server about
// a screen (a navigation's data, a saved change), the screen's HTML is refreshed a moment later —
// debounced, so a burst of check-offs costs one refresh — and launching offline shows where they left off.
const REFRESH_DELAY_MS = 1500;
const pendingRefresh = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; done: () => void }
>();

/** The same screen always has the same key: Next's per-request `_rsc` marker is dropped. */
function screenKey(input: string): string | null {
  const url = new URL(input, self.location.origin);
  if (url.origin !== self.location.origin || NEVER_CACHE.test(url.pathname)) return null;
  url.searchParams.delete("_rsc");
  return url.pathname + url.search;
}

function refreshScreen(input: string, event: ExtendableEvent) {
  const key = screenKey(input);
  if (!key) return;
  const earlier = pendingRefresh.get(key);
  if (earlier) {
    clearTimeout(earlier.timer);
    earlier.done();
  }
  event.waitUntil(
    new Promise<void>((resolve) => {
      const timer = setTimeout(async () => {
        pendingRefresh.delete(key);
        try {
          if (!(await hasSession())) return resolve();
          const request = new Request(key, {
            credentials: "same-origin",
            // A redirect (signed out → /sign-in) must not be stored as if it were the screen.
            redirect: "manual",
            headers: { "x-pinched-warm": "1" },
          });
          await pagesStrategy.handle({ request, event });
        } catch {
          // offline, or the server is unreachable: keep the copy we have
        }
        resolve();
      }, REFRESH_DELAY_MS);
      pendingRefresh.set(key, { timer, done: resolve });
    }),
  );
}

const runtimeCaching: RuntimeCaching[] = [
  // Auth, import, Stripe and every other API route: always the network, never stored. The one
  // exception is local demo mode's media route, which stands in for Supabase Storage below.
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin && NEVER_CACHE.test(url.pathname) && !url.pathname.startsWith(LOCAL_MEDIA_PATH),
    handler: new NetworkOnly(),
  },
  // Page navigations (and the post-login route warm-up): fresh online, cached copy with no signal.
  { matcher: isCacheablePage, handler: pagesStrategy },
  // A saved change (a Server Action posts to the screen it was made on): afterwards, refresh that
  // screen's cached HTML. Otherwise the request is untouched — the worker only listens.
  {
    matcher: ({ request, sameOrigin }) =>
      sameOrigin && request.method === "POST" && request.headers.has("Next-Action"),
    method: "POST",
    handler: new NetworkOnly({
      plugins: [
        {
          fetchDidSucceed: async ({ request, response, event }) => {
            if (response.ok) refreshScreen(request.url, event);
            return response;
          },
        },
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
        onlyWhileSignedIn,
        new ExpirationPlugin({ maxEntries: 50, purgeOnQuotaError: true }),
        {
          // A client-side navigation (or refresh) just fetched this screen's data: keep its HTML fresh too.
          fetchDidSucceed: async ({ request, response, event }) => {
            if (response.ok) refreshScreen(request.url, event);
            return response;
          },
        },
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
      (url.pathname.includes("/storage/v1/object/") || url.pathname.startsWith(LOCAL_MEDIA_PATH)) &&
      request.destination !== "document" &&
      // Video is streamed with Range requests (Safari insists on 206s); leave those to the network.
      !request.headers.has("range"),
    method: "GET",
    handler: new CacheFirst({
      cacheName: CACHE.media,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 120,
          maxAgeSeconds: 60 * 60 * 24 * 30,
          purgeOnQuotaError: true,
        }),
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
  // Screens waiting to be refreshed belong to the person who is leaving.
  for (const { timer, done } of pendingRefresh.values()) {
    clearTimeout(timer);
    done();
  }
  pendingRefresh.clear();
  await Promise.all(USER_SCOPED_CACHES.map((name) => caches.delete(name)));
}

async function syncSession(userId: string | null) {
  const meta = await caches.open(CACHE.meta);
  const key = new Request(SESSION_KEY);
  const previous = await meta.match(key).then((r) => r?.text());
  if (userId === null) {
    // The marker goes first: a page already on its way is then refused instead of written back
    // after the purge (see onlyWhileSignedIn).
    await meta.delete(key);
    await clearUserCaches();
    return;
  }
  if (previous !== undefined && previous !== userId) await clearUserCaches();
  if (previous !== userId) await meta.put(key, new Response(userId));
}

type PinchedMessage =
  { type: "PINCHED_SESSION"; userId: string | null } | { type: "PINCHED_CLEAR_CACHES" };

self.addEventListener("message", (event) => {
  const data = event.data as PinchedMessage | undefined;
  if (!data || typeof data !== "object") return;
  if (data.type === "PINCHED_SESSION") {
    const source = event.source;
    event.waitUntil(
      syncSession(typeof data.userId === "string" ? data.userId : null).then(() => {
        // Tell the page its session is settled, so it can warm the caches without racing a purge.
        source?.postMessage({ type: "PINCHED_SESSION_SYNCED" });
      }),
    );
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
  const target = new URL(
    (event.notification.data as { url?: string } | undefined)?.url ?? "/plan",
    self.location.origin,
  ).href;
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
