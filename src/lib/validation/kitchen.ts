import { z } from "zod";

import { KITCHEN_LOCATIONS } from "@/lib/domain/constants";

import { isoDate, optionalText, uuid } from "./common";

export const quickAddSchema = z.object({
  text: z.string().trim().min(1, "Type something you have, like “6 eggs”.").max(2000),
  /** Where they are adding it from; omitted on "All", so each item gets a sensible default. */
  location: z.enum(KITCHEN_LOCATIONS).nullish(),
});

const quantity = z.number().min(0, "Quantity can't be negative.").max(100_000).nullable();

export const kitchenItemSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(120),
  quantity,
  unit: optionalText(40),
  location: z.enum(KITCHEN_LOCATIONS),
  expires_at: isoDate.nullish().transform((value) => value ?? null),
  note: optionalText(300),
});

export const updateKitchenItemSchema = kitchenItemSchema.extend({ id: uuid });
export type KitchenItemInput = z.input<typeof kitchenItemSchema>;
