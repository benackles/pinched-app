import { afterEach, describe, expect, it, vi } from "vitest";

import { appUrl } from "@/server/env";

const VARS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function with_(env: Partial<Record<(typeof VARS)[number], string>>) {
  for (const name of VARS) vi.stubEnv(name, env[name] ?? "");
  return appUrl();
}

afterEach(() => vi.unstubAllEnvs());

describe("appUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL when it is set, without a trailing slash", () => {
    expect(with_({ NEXT_PUBLIC_APP_URL: "https://pinched.example/" })).toBe(
      "https://pinched.example",
    );
  });

  it("lets the explicit address win even on Vercel", () => {
    expect(
      with_({
        NEXT_PUBLIC_APP_URL: "https://pinched.example",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "pinched.vercel.app",
      }),
    ).toBe("https://pinched.example");
  });

  it("uses the project's production domain on a production deployment", () => {
    expect(
      with_({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "pinched.vercel.app",
        VERCEL_URL: "pinched-abc123.vercel.app",
      }),
    ).toBe("https://pinched.vercel.app");
  });

  it("uses the deployment's own address on a preview, never the production domain", () => {
    expect(
      with_({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "pinched.vercel.app",
        VERCEL_URL: "pinched-git-feature-me.vercel.app",
      }),
    ).toBe("https://pinched-git-feature-me.vercel.app");
  });

  it("falls back to the deployment address when a production deployment has no project domain", () => {
    expect(with_({ VERCEL_ENV: "production", VERCEL_URL: "pinched-abc123.vercel.app" })).toBe(
      "https://pinched-abc123.vercel.app",
    );
  });

  it("is localhost when nothing is set", () => {
    expect(with_({})).toBe("http://localhost:3000");
  });
});
