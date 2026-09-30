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

type Result<T> = { data: T; error: PostgrestError | null };

function raise(error: PostgrestError): never {
  throw new DbError(error.code, error.message, error.details);
}

/** The rows (or row) of a query that must succeed and must return something. */
export function must<T>(result: Result<T>): NonNullable<T> {
  if (result.error) raise(result.error);
  if (result.data === null || result.data === undefined) {
    throw new DbError("PGRST116", "No rows returned");
  }
  return result.data as NonNullable<T>;
}

/** For `.maybeSingle()`: the row, or null when there is none. */
export function mustMaybe<T>(result: Result<T>): T {
  if (result.error) raise(result.error);
  return result.data;
}

/** For writes that return nothing: throws on error. */
export function mustOk(result: { error: PostgrestError | null }): void {
  if (result.error) raise(result.error);
}
