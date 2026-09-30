import { addDays, dayName, shortDate, weekDays } from "@/lib/domain/week";

/** Day choices for "add to week": this week's seven days, optionally followed by next week's. */
export function dayOptions(
  weekStart: string,
  weeks: 1 | 2 = 1,
): { value: string; label: string }[] {
  const days = [...weekDays(weekStart), ...(weeks === 2 ? weekDays(addDays(weekStart, 7)) : [])];
  return days.map((value) => ({ value, label: `${dayName(value)} ${shortDate(value)}` }));
}
