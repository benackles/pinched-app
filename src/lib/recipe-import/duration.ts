/** ISO 8601 durations as schema.org uses them (PT1H15M, PT45M, P0DT30M) → whole minutes. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const iso =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      text,
    );
  if (iso && iso[0] !== "P" && iso[0].toUpperCase() !== "PT") {
    const [, w, d, h, m, s] = iso.map((part) => (part === undefined ? 0 : Number(part)));
    return Math.round(w! * 7 * 24 * 60 + d! * 24 * 60 + h! * 60 + m! + s! / 60);
  }

  // Some sites write "1 hour 30 minutes" or "45 min".
  let minutes = 0;
  let matched = false;
  for (const [, amount, unit] of text.matchAll(
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi,
  )) {
    matched = true;
    minutes += /^h/i.test(unit!) ? Number(amount) * 60 : Number(amount);
  }
  return matched ? Math.round(minutes) : null;
}
