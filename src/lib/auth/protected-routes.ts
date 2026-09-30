/** Everything behind the sign-in wall. Public: the landing page, auth pages, offline page, webhooks. */
export const PROTECTED_PREFIXES = [
  "/plan",
  "/recipes",
  "/kitchen",
  "/grocery-list",
  "/prep",
  "/cook",
  "/collections",
  "/settings",
  "/upgrade",
] as const;

/**
 * The proxy redirects signed-out visitors early for a fast, friendly bounce. It is NOT the
 * security boundary: every protected layout, page and server action re-checks the session itself
 * (`requireSession()`), and Row Level Security is the final backstop.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
