/**
 * Which identity provider is active.
 *
 * - Production: Clerk. Both the publishable and secret keys must be set.
 * - Local mode (`PINCHED_LOCAL=1`): a credential-free, in-process demo backend for development,
 *   tests and design review. It can NEVER be active on a real deployment: it is refused whenever
 *   Clerk keys are present or the app runs on Vercel.
 */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export function isLocalMode(): boolean {
  return process.env.PINCHED_LOCAL === "1" && !process.env.VERCEL && !isClerkConfigured();
}

export type AuthMode = "clerk" | "local" | "unconfigured";

export function authMode(): AuthMode {
  if (isClerkConfigured()) return "clerk";
  if (isLocalMode()) return "local";
  return "unconfigured";
}
