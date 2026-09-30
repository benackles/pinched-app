"use client";

import Link from "next/link";
import { toast } from "sonner";

import type { ActionError, ActionResult } from "./types";

/** Shows a failed action as a toast. Hitting a free-plan limit offers the upgrade. */
export function toastError(error: ActionError) {
  if (error.code === "free_limit") {
    toast.error(error.message, {
      action: (
        <Link
          href="/settings#billing"
          className="ml-auto rounded-full bg-primary-strong px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          See Pro
        </Link>
      ),
    });
    return;
  }
  toast.error(error.message);
}

/**
 * Unwraps an action result on the client: toasts the error (or an optional success message)
 * and returns the data, or `null` when it failed.
 */
export function unwrap<T>(result: ActionResult<T>, success?: string): { data: T } | null {
  if (!result.ok) {
    toastError(result.error);
    return null;
  }
  if (success) toast.success(success);
  return { data: result.data };
}
