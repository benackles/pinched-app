import { z } from "zod";

/**
 * Product analytics: the complete list of what is ever sent. Events carry an opaque user id (the
 * Clerk id) and the small, non-identifying properties below — never an email, a name, a recipe
 * title, a URL path or free text. They exist to answer the PRD's questions: activation, time to
 * first plan, week-2 return, prep completion, PWA installs and paid conversion.
 */
export type EventProps = {
  /** Activation funnel starts here (Clerk webhook). */
  signed_up: Record<string, never>;
  recipe_saved: { source: "seeded" | "url_import" | "manual" };
  /** The site a recipe was imported from (a hostname, e.g. "example.com"), to see what imports well. */
  recipe_imported: { host: string };
  /** `meals_in_week >= 3` is "a first plan"; distinct `week_start` per person is week-2 return. */
  meal_added: { meals_in_week: number; week_start: string };
  /** `created: true` is the first time the week's list was built. */
  grocery_generated: { created: boolean; meals: number; items_to_buy: number };
  prep_generated: { created: boolean; tasks: number; minutes: number; saved_minutes: number };
  /** Progress through the plan: prep completion is tasks_done / tasks_total. */
  prep_task_completed: { tasks_done: number; tasks_total: number };
  cooked_logged: { rated: boolean };
  push_enabled: Record<string, never>;
  checkout_started: { plan: "monthly" | "yearly" };
  /** A card-up-front trial (`trial: true`) or a direct paid start. */
  subscription_started: { plan: string; trial: boolean };
  /** The free trial turned into a paid plan: the PRD's paid conversion. */
  subscription_converted: { plan: string };
  subscription_ended: { plan: string };
  install_prompt_shown: { platform: "ios" | "other" };
  install_accepted: Record<string, never>;
  install_dismissed: Record<string, never>;
  /** Launched from the Home Screen / installed window rather than a browser tab (once per session). */
  pwa_opened: { platform: "ios" | "other" };
};

export type EventName = keyof EventProps;

/** The few events only the browser can observe. Everything else is recorded where it happens, on the server. */
export const CLIENT_EVENTS = [
  "install_prompt_shown",
  "install_accepted",
  "install_dismissed",
  "pwa_opened",
] as const satisfies readonly EventName[];

export const clientEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("install_prompt_shown"), platform: z.enum(["ios", "other"]) }),
  z.object({ event: z.literal("install_accepted") }),
  z.object({ event: z.literal("install_dismissed") }),
  z.object({ event: z.literal("pwa_opened"), platform: z.enum(["ios", "other"]) }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

/** Only plain, short values leave the building: a stray object or long string is dropped, not sent. */
export function cleanProps(
  props: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string") out[key] = value.slice(0, 100);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** People who send Global Privacy Control or Do Not Track are not tracked at all. */
export function optedOut(headers: { get(name: string): string | null }): boolean {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1";
}
