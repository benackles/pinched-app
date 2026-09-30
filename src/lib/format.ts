/** "25 min", "1 hr", "1 hr 5 min" */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "";
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

/** Escapes LIKE wildcards so user text is matched literally. */
export const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A value safe inside a PostgREST `or(...)` list: double-quoted, inner quotes and backslashes escaped. */
export const pgrstQuote = (text: string) => `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
