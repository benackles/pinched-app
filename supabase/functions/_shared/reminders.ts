/**
 * Reminder rules and wording. Pure: no network, no Deno or Node APIs, so it runs in the Edge
 * Function and in the unit tests alike. The job (../send-reminders/core.ts) does the I/O.
 *
 * Two opt-in notifications, both at the person's chosen time of day, in their own time zone:
 *  - prep_day        the day a prep session is planned for, with how long it will take
 *  - tonights_dinner what is planned for dinner today
 */

export type ReminderKind = "prep_day" | "tonights_dinner";

/** The job runs every few minutes; a reminder is "due" from its time until this long after. */
export const DEFAULT_WINDOW_MINUTES = 60;

export type RecipientProfile = {
  user_id: string;
  timezone: string | null;
  /** Postgres `time`: "17:00:00" (or "17:00"). */
  reminder_time: string;
  remind_prep: boolean;
  remind_dinner: boolean;
};

export type PushMessage = { title: string; body: string; url: string; tag: string };

// ─────────────────────────────── time ───────────────────────────────

export function validZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The calendar date ("2026-10-05") and minutes since midnight for `now` in `timeZone`. */
export function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** "17:00:00" or "17:00" → 1020. Anything else → null. */
export function parseReminderTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Due from the chosen minute until `windowMinutes` later — never past midnight. */
export function inWindow(minutes: number, target: number, windowMinutes: number): boolean {
  return minutes >= target && minutes < Math.min(24 * 60, target + windowMinutes);
}

/**
 * Which reminders may go out to this person right now, and for which local date. Whether there is
 * anything to say (a prep plan today, a dinner planned) is decided where the data is loaded.
 */
export function dueReminders(
  profile: RecipientProfile,
  now: Date,
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): { localDate: string; kinds: ReminderKind[] } | null {
  const target = parseReminderTime(profile.reminder_time);
  if (target === null) return null;
  const { date, minutes } = localParts(now, validZone(profile.timezone) ?? "UTC");
  if (!inWindow(minutes, target, windowMinutes)) return null;

  const kinds: ReminderKind[] = [];
  if (profile.remind_prep) kinds.push("prep_day");
  if (profile.remind_dinner) kinds.push("tonights_dinner");
  return kinds.length ? { localDate: date, kinds } : null;
}

// ─────────────────────────────── wording ───────────────────────────────

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

/** "25 min", "1 hr", "1 hr 5 min" */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** "A", "A and B", "A, B and 1 more" */
export function listTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  const more = titles.length - 2;
  return `${titles[0]}, ${titles[1]} and ${more} more`;
}

export function prepMessage(input: { taskCount: number; minutes: number }): PushMessage {
  const time = input.minutes > 0 ? ` — about ${formatMinutes(input.minutes)}` : "";
  return {
    title: "It's prep day",
    body: `${pluralize(input.taskCount, "task")} to get ahead of the week${time}. Tap to start.`,
    url: "/prep",
    tag: "prep-day",
  };
}

export function dinnerMessage(meals: { id: string; title: string }[]): PushMessage | null {
  if (meals.length === 0) return null;
  return {
    title: "Tonight's dinner",
    body: listTitles(meals.map((meal) => meal.title)),
    // One meal goes straight to cooking it; several open the week.
    url: meals.length === 1 ? `/cook/${meals[0]!.id}` : "/plan",
    tag: "tonights-dinner",
  };
}
