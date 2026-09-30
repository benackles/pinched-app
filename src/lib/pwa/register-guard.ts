/**
 * Service-worker registration guard.
 *
 * PRD: the worker registers only in production on the canonical domain. It is skipped — and any
 * stray worker unregistered — on localhost and dev builds, inside iframes, and on Vercel preview
 * deployments. This keeps previews from serving stale code.
 *
 * Kept as a pure function so every rule is unit-tested without a browser.
 */
export type RegisterContext = {
  /** NEXT_PUBLIC_PWA_PRODUCTION === "1": a production build on a production deployment. */
  isProductionDeployment: boolean;
  hostname: string;
  /** Hostname of NEXT_PUBLIC_APP_URL, when configured. */
  canonicalHost?: string | undefined;
  /** NEXT_PUBLIC_PWA_ALLOW_LOCALHOST === "1": QA an installed PWA on a local production build. */
  allowLocalhost?: boolean | undefined;
  inIframe: boolean;
  /** window.location.search — `?sw=off` lets anyone opt a session out while debugging. */
  search: string;
};

export type RegisterDecision = { register: true } | { register: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

export function shouldRegisterServiceWorker(ctx: RegisterContext): RegisterDecision {
  if (!ctx.isProductionDeployment)
    return { register: false, reason: "not a production deployment" };
  if (ctx.inIframe) return { register: false, reason: "inside an iframe" };
  if (new URLSearchParams(ctx.search).get("sw") === "off") {
    return { register: false, reason: "opted out with ?sw=off" };
  }
  if (isLocalHostname(ctx.hostname) && !ctx.allowLocalhost) {
    return { register: false, reason: "localhost" };
  }
  if (ctx.canonicalHost && ctx.hostname !== ctx.canonicalHost && !isLocalHostname(ctx.hostname)) {
    return { register: false, reason: "not the canonical domain" };
  }
  return { register: true };
}

/** Caches owned by the worker; removed when a worker is refused so a preview never reads stale ones. */
export const SW_CACHE_NAMES = [
  "pages",
  "pages-rsc",
  "start-url",
  "pinched-data",
  "pinched-media",
  "pinched-meta",
] as const;
