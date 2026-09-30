import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/** Revision for precache entries that are not content-hashed by the build (e.g. /~offline). */
const revision = (() => {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return randomUUID();
  }
})();

/**
 * The service worker only registers on the production deployment. On Vercel that means
 * VERCEL_ENV === "production" (previews are skipped); elsewhere NODE_ENV === "production".
 * The runtime guard in src/lib/pwa/register-guard.ts repeats these checks on the client.
 */
const isProductionDeployment = process.env.VERCEL
  ? process.env.VERCEL_ENV === "production"
  : process.env.NODE_ENV === "production";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // We register the worker ourselves behind the production-only guard, and we never
  // force-reload the page when connectivity returns (people are mid-shop or mid-prep).
  register: false,
  reloadOnOnline: false,
  // Pages opened via client-side navigation are cached too, so they open with no signal.
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV === "development",
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
});

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The build checks the app; tests, scripts and Edge Functions are checked by `pnpm typecheck`.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  poweredByHeader: false,
  typedRoutes: true,
  // Acknowledge Turbopack for `next dev`; production builds use webpack (Serwist requires it).
  turbopack: {},
  // PGlite powers the credential-free local mode only. Keep it out of server bundles and
  // out of the traced production output.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingExcludes: {
    "*": ["node_modules/@electric-sql/pglite/**"],
  },
  env: {
    NEXT_PUBLIC_PWA_PRODUCTION: isProductionDeployment ? "1" : "0",
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must always be revalidated so deploys activate immediately.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
