import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real app in local mode — the same Next.js server, real Postgres (PGlite)
 * with the real migrations and RLS, the real supabase-js client — so no credentials are needed.
 *
 *   pnpm test:e2e                    # against `next dev` (started for you)
 *   pnpm build:e2e && E2E_PROD=1 pnpm test:e2e   # against a production build (also runs the service-worker specs)
 *
 * E2E_CHROMIUM_PATH points at an existing Chromium when `playwright install` isn't available.
 */
const port = Number(process.env.E2E_PORT ?? 3200);
const prod = process.env.E2E_PROD === "1";
const dataDir = path.join(os.tmpdir(), "pinched-e2e");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    // Fail in seconds, not minutes, when a control is missing.
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    timezoneId: "America/Los_Angeles",
    launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH || undefined },
  },
  projects: [
    // Phone first: the PWA is mostly used standing in a kitchen or a shop.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: prod ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
    url: `http://localhost:${port}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PINCHED_LOCAL: "1",
      PINCHED_LOCAL_DB: "memory",
      PINCHED_LOCAL_DIR: dataDir,
      // The URL-import tests serve a recipe page from localhost.
      PINCHED_IMPORT_ALLOW_PRIVATE: "1",
      NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
      SERWIST_SUPPRESS_TURBOPACK_WARNING: "1",
    },
  },
});
