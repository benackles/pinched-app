import { z } from "zod";

import {
  optionalMinutes,
  optionalText,
  optionalUrl,
  servingsInt,
  stripStepNumber,
  toLines,
} from "./common";

const MAX_INGREDIENTS = 120;
const MAX_STEPS = 100;

/** Manual entry, editing your own recipe, and confirming a URL import all use this shape. */
export const recipeFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the recipe a title.")
    .max(140, "Keep the title under 140 characters."),
  author: optionalText(120),
  source_url: optionalUrl,
  image_url: optionalUrl,
  servings: z
    .number()
    .int("Whole servings only.")
    .min(1, "At least 1 serving.")
    .max(999, "That's a lot of servings.")
    .nullish()
    .transform((value) => value ?? null),
  servings_label: optionalText(120),
  prep_minutes: optionalMinutes,
  cook_minutes: optionalMinutes,
  /** One ingredient per line; "For the sauce:" lines start a group. */
  ingredients: z
    .string()
    .max(20_000)
    .transform(toLines)
    .refine((lines) => lines.length >= 1, "Add at least one ingredient.")
    .refine((lines) => lines.length <= MAX_INGREDIENTS, `Keep it to ${MAX_INGREDIENTS} lines.`),
  /** One step per line. */
  steps: z
    .string()
    .max(40_000)
    .transform((text) => toLines(text).map(stripStepNumber).filter(Boolean))
    .refine((lines) => lines.length >= 1, "Add at least one step.")
    .refine((lines) => lines.length <= MAX_STEPS, `Keep it to ${MAX_STEPS} steps.`),
});
export type RecipeFormInput = z.input<typeof recipeFormSchema>;
export type RecipeFormData = z.output<typeof recipeFormSchema>;

export const importUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste a recipe link.")
    .max(2000, "That link is too long.")
    .transform((value) => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`)),
});

export const versionSchema = z.object({
  recipeId: z.uuid(),
  title: z.string().trim().min(1, "Give your version a title.").max(140),
  servings: servingsInt.nullable(),
  total_minutes: optionalMinutes,
  ingredients: z
    .array(z.string().trim().min(1).max(300))
    .min(1, "Keep at least one ingredient.")
    .max(MAX_INGREDIENTS),
  steps: z
    .array(z.string().trim().min(1).max(2000))
    .min(1, "Keep at least one step.")
    .max(MAX_STEPS),
});
export type VersionInput = z.input<typeof versionSchema>;

export const noteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Write a note first.")
    .max(4000, "Keep notes under 4,000 characters."),
});

export const collectionNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the collection a name.")
    .max(80, "Keep it under 80 characters."),
});

export const cookedSchema = z.object({
  recipeId: z.uuid(),
  plannedMealId: z.uuid().nullish(),
  cookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rating: z.number().int().min(1).max(5).nullish(),
  note: z.string().trim().max(2000).nullish(),
});
