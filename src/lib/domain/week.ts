/**
 * Dates as `YYYY-MM-DD` strings, computed with UTC arithmetic so results never depend on the
 * server's or browser's timezone. Only "what day is it right now" needs a timezone, and that
 * takes the person's IANA zone explicitly.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: string): boolean {
  const match = ISO.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function utc(iso: string): Date {
  if (!isISODate(iso)) throw new RangeError(`Invalid date: ${iso}`);
  return new Date(`${iso}T00:00:00Z`);
}

const toISO = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  return utc(iso).getUTCDay() || 7;
}

export function mondayOf(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function isMonday(iso: string): boolean {
  return isISODate(iso) && isoWeekday(iso) === 1;
}

/** Monday through Sunday for the week starting on `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function shiftWeek(monday: string, weeks: number): string {
  return addDays(monday, weeks * 7);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** Today's date in the person's own timezone (falls back to UTC for a missing or bad zone). */
export function todayInZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return toISO(now);
  }
}

export function currentWeekStart(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  return mondayOf(todayInZone(timeZone, now));
}

/** `YYYY-MM` in the person's timezone — the bucket for monthly free-tier counters. */
export function monthKey(timeZone: string | null | undefined, now: Date = new Date()): string {
  return todayInZone(timeZone, now).slice(0, 7);
}

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
const DAY_LONG = fmt({ weekday: "long" });
const DAY_SHORT = fmt({ weekday: "short" });
const DATE_SHORT = fmt({ month: "short", day: "numeric" });
const DATE_LONG = fmt({ month: "long", day: "numeric", year: "numeric" });

export const dayName = (iso: string) => DAY_LONG.format(utc(iso));
export const shortDay = (iso: string) => DAY_SHORT.format(utc(iso));
export const shortDate = (iso: string) => DATE_SHORT.format(utc(iso));
export const longDate = (iso: string) => DATE_LONG.format(utc(iso));

/** "Sep 28 – Oct 4" */
export function weekRangeLabel(monday: string): string {
  return `${shortDate(monday)} – ${shortDate(addDays(monday, 6))}`;
}

/**
 * The date of the prep session for a week, from the preferred weekday (1 = Monday … 7 = Sunday).
 * Friday, Saturday and Sunday mean the days BEFORE the week starts; Monday is the first day;
 * Tuesday–Thursday fall inside the week.
 */
export function prepDateFor(weekStart: string, preferredWeekday: number): string {
  if (preferredWeekday >= 5) return addDays(weekStart, preferredWeekday - 8);
  return addDays(weekStart, preferredWeekday - 1);
}

/** Dates a prep session may be moved to: three days before the week through its last day. */
export function prepDateOptions(weekStart: string): string[] {
  return Array.from({ length: 10 }, (_, i) => addDays(weekStart, i - 3));
}
