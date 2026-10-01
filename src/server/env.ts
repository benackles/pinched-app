import "server-only";

export class ConfigError extends Error {}

function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function required(label: string, ...names: string[]): string {
  const value = read(...names);
  if (!value) {
    throw new ConfigError(`Missing ${label}. Set ${names.join(" or ")} (see .env.example).`);
  }
  return value;
}

/** Supabase project URL and the public (anon / publishable) key. */
export function supabasePublicEnv() {
  return {
    url: required("the Supabase project URL", "NEXT_PUBLIC_SUPABASE_URL"),
    key: required(
      "the Supabase anon key",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
  };
}

/** Server-only. Bypasses RLS — used by webhooks and jobs, never on behalf of a request's user. */
export function supabaseServiceKey(): string {
  return required(
    "the Supabase service-role key",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  );
}

/**
 * Where the app lives, for links that leave it (Stripe's return URLs) and absolute URLs in page
 * metadata. An explicit NEXT_PUBLIC_APP_URL always wins. Without one, on Vercel: the project's
 * production domain for the production deployment, and the deployment's own address for a preview —
 * so a preview deployment works with no per-environment setup. Elsewhere: localhost.
 */
export function appUrl(): string {
  const explicit = read("NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const host =
    process.env.VERCEL_ENV === "production"
      ? read("VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL")
      : read("VERCEL_URL");
  return host ? `https://${host}` : "http://localhost:3000";
}
