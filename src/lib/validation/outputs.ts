import { z } from "zod";

import { GROCERY_SECTIONS } from "@/lib/domain/constants";
import { isISODate, mondayOf } from "@/lib/domain/week";

import { optionalText, uuid } from "./common";

/** Client-side clock for last-write-wins; the server never trusts it past "now". */
const at = z.number().int().positive();

export const checkSchema = z.object({ id: uuid, checked: z.boolean(), at });
export const completeSchema = z.object({ id: uuid, completed: z.boolean(), at });

export const weekSchema = z.object({
  weekStart: z.string().refine(isISODate, "Pick a valid week.").transform(mondayOf),
});

export const customGrocerySchema = weekSchema.extend({
  text: z.string().trim().min(1, "Type an item, like “2 limes”.").max(200),
  section: z.enum(GROCERY_SECTIONS).default("Other"),
});

export const editGrocerySchema = z.object({
  id: uuid,
  name: z.string().trim().min(1, "Give it a name.").max(120),
  quantity: z.number().min(0).max(100_000).nullable(),
  unit: optionalText(40),
  section: z.enum(GROCERY_SECTIONS),
});

export const prepTaskSchema = z.object({
  title: z.string().trim().min(1, "Name the task.").max(140),
  description: optionalText(1000),
  minutes: z.number().int().min(0, "Minutes can't be negative.").max(720),
});
export const editPrepTaskSchema = prepTaskSchema.extend({ id: uuid });
export const addPrepTaskSchema = weekSchema.extend(prepTaskSchema.shape);
