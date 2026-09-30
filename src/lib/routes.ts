import type { Route } from "next";

/**
 * Typed routes don't accept an optional catch-all's base path (Clerk's `/sign-in/[[...sign-in]]`),
 * so the sign-in and sign-up URLs are named here once.
 */
export const SIGN_IN = "/sign-in" as Route;
export const SIGN_UP = "/sign-up" as Route;

/** A weekly screen for a given week; the current week uses the bare path. */
export function withWeek(
  path: "/plan" | "/grocery-list" | "/prep",
  week: string,
  currentWeek: string,
): Route {
  return (week === currentWeek ? path : `${path}?week=${week}`) as Route;
}

/** An absolute URL outside the app (Stripe Checkout, the billing portal) for redirect(). */
export const external = (url: string) => url as Route;
