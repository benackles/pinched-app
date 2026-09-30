import "server-only";

import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import {
  FREE_LIMIT_MESSAGES,
  fail,
  ok,
  type ActionError,
  type ActionErrorCode,
  type ActionResult,
} from "@/lib/actions/types";
import { DbError } from "@/server/db";

/** A failure an action raises on purpose (not found, forbidden…), with a user-facing message. */
export class ActionFailure extends Error {
  constructor(
    public code: ActionErrorCode,
    message: string,
    public extra: Partial<Omit<ActionError, "code" | "message">> = {},
  ) {
    super(message);
  }
}

function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

export function toActionError(error: unknown): ActionResult<never> {
  // redirect() / notFound() are control flow, not failures.
  unstable_rethrow(error);

  if (error instanceof ActionFailure) {
    const feature = error.extra.feature;
    const message =
      error.message ||
      (error.code === "free_limit" && feature ? FREE_LIMIT_MESSAGES[feature] : undefined) ||
      "Something went wrong. Please try again.";
    return fail(error.code, message, error.extra);
  }
  if (error instanceof ZodError) {
    const fields = fieldErrors(error);
    return fail("validation", Object.values(fields)[0] ?? "Check the highlighted fields.", {
      fields,
    });
  }
  if (error instanceof DbError) {
    const free = /^free_limit:(.+)$/.exec(error.message);
    if (free) {
      return fail(
        "free_limit",
        FREE_LIMIT_MESSAGES[free[1]!] ?? "You have reached the free plan limit.",
        { feature: free[1]! },
      );
    }
    const rate = /^limit_exceeded:(.+)$/.exec(error.message);
    if (rate && rate[1]!.startsWith("url_import:")) {
      return fail("free_limit", FREE_LIMIT_MESSAGES.url_import!, { feature: "url_import" });
    }
    if (rate) {
      return fail("rate_limit", "You've hit today's limit for that. Try again tomorrow.", {
        feature: rate[1]!,
      });
    }
    if (error.code === "23505") return fail("conflict", "That already exists.");
    if (error.code === "42501" || error.code === "PGRST116") {
      return fail("not_found", "We couldn't find that.");
    }
    if (error.code === "23514" || error.code === "22P02" || error.code === "23502") {
      return fail("validation", "That value isn't allowed.");
    }
  }
  console.error("[action] unexpected error", error);
  return fail("unknown", "Something went wrong. Please try again.");
}

/** Wraps an action body so thrown errors become an ActionResult. */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await body());
  } catch (error) {
    return toActionError(error);
  }
}
