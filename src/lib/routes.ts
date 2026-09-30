import type { Route } from "next";

/**
 * Typed routes don't accept an optional catch-all's base path (Clerk's `/sign-in/[[...sign-in]]`),
 * so the sign-in and sign-up URLs are named here once.
 */
export const SIGN_IN = "/sign-in" as Route;
export const SIGN_UP = "/sign-up" as Route;
