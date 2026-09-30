"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, type ActionResult } from "@/lib/actions/types";
import { isLocalMode } from "@/lib/auth/config";
import {
  LOCAL_SESSION_COOKIE,
  LOCAL_SESSION_SECONDS,
  localUserId,
  mintLocalToken,
} from "@/server/local/session";

import { toActionError } from "./result";

const signInSchema = z.object({
  email: z.email("Enter a valid email address.").max(200),
  name: z
    .string()
    .trim()
    .max(80, "Keep the name under 80 characters.")
    .optional()
    .transform((value) => value || null),
});

/**
 * Local demo mode only: "sign in" with any email, no password. The cookie holds a signed token
 * carrying the same claims Clerk's session token does, so Row Level Security behaves identically.
 * Refused unless local mode is active (never on a real deployment).
 */
export async function signInLocal(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!isLocalMode()) return fail("forbidden", "Local sign-in is not available here.");
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
  });
  if (!parsed.success) return toActionError(parsed.error);

  const email = parsed.data.email.trim().toLowerCase();
  const token = mintLocalToken({ userId: localUserId(email), email, name: parsed.data.name });
  const jar = await cookies();
  jar.set(LOCAL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOCAL_SESSION_SECONDS,
  });
  redirect("/plan");
}

export async function signOutLocal(): Promise<void> {
  const jar = await cookies();
  jar.delete(LOCAL_SESSION_COOKIE);
  redirect("/");
}
