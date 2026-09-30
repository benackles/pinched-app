/** What a server action tells the client. Actions never throw across the wire; they return this. */
export type ActionErrorCode =
  | "validation"
  | "free_limit"
  | "rate_limit"
  | "not_found"
  | "conflict"
  | "forbidden"
  | "import_failed"
  | "unknown";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
  /** For free_limit / rate_limit: which quota was hit (e.g. "saved_recipes", "url_import"). */
  feature?: string;
  /** Field-level messages for forms, keyed by field path. */
  fields?: Record<string, string>;
};

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ActionError };

export const ok = <T = undefined>(data?: T): ActionResult<T> => ({ ok: true, data: data as T });

export const fail = (
  code: ActionErrorCode,
  message: string,
  extra: Partial<Omit<ActionError, "code" | "message">> = {},
): ActionResult<never> => ({ ok: false, error: { code, message, ...extra } });

export const FREE_LIMIT_MESSAGES: Record<string, string> = {
  saved_recipes: "Free accounts can save up to 25 recipes. Upgrade to Pro for unlimited.",
  prep_plans:
    "Free accounts can build the prep plan for the next 2 weeks. Upgrade to Pro for every week.",
  recipe_media: "Free accounts can attach one photo or video per recipe. Upgrade to Pro for more.",
  url_import: "Free accounts can import 5 recipes a month. Upgrade to Pro for unlimited imports.",
};
