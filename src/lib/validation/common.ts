import { z } from "zod";

import { isISODate } from "@/lib/domain/week";

export const uuid = z.uuid("That doesn't look right.");

export const isoDate = z.string().refine(isISODate, "Use a valid date.");

export const servingsInt = z
  .number()
  .int()
  .min(1, "At least 1 serving.")
  .max(99, "That's a lot of servings.");

/** Free text, trimmed. Empty strings become null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .nullish()
    .transform((value) => value || null);

export const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((value) => value || null)
  .refine(
    (value) => value === null || /^https?:\/\//i.test(value),
    "Use a web address starting with http:// or https://",
  );

export const optionalMinutes = z
  .number()
  .int()
  .min(0)
  .max(1440 * 3)
  .nullish()
  .transform((value) => value ?? null);

/** One item per non-empty line. */
export const toLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** "1. Chop the onion" → "Chop the onion" */
export const stripStepNumber = (line: string): string =>
  line.replace(/^\s*(?:step\s*)?\d+\s*[.):]\s*/i, "").trim();
