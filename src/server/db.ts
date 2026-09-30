import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

/** A failed Supabase/PostgREST call. `message` carries raised exceptions such as `free_limit:saved_recipes`. */
export class DbError extends Error {
  constructor(
    public code: string | undefined,
    message: string,
    public details: string | null = null,
  ) {
    super(message);
  }
}

type Result<T> = { data: T | null; error: PostgrestError | null };

function raise(error: PostgrestError): never {
  throw new DbError(error.code, error.message, error.details);
}

/** The rows (or row) of a query that must succeed. */
export function must<T>(result: Result<T>): T {
  if (result.error) raise(result.error);
  return result.data as T;
}

/** For writes that return nothing: throws on error. */
export function mustOk(result: { error: PostgrestError | null }): void {
  if (result.error) raise(result.error);
}

/** Like `must`, but a missing row (PGRST116 from .single()) is null instead of an error. */
export function mustOrNull<T>(result: Result<T>): T | null {
  if (result.error) {
    if (result.error.code === "PGRST116") return null;
    raise(result.error);
  }
  return result.data;
}
