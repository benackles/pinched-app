import { z } from "zod";

import { MEAL_TYPES } from "@/lib/domain/constants";

import { isoDate, servingsInt, uuid } from "./common";

export const addMealSchema = z.object({
  recipeId: uuid,
  date: isoDate,
  mealType: z.enum(MEAL_TYPES),
  servings: servingsInt,
});

export const updateMealSchema = z
  .object({
    mealId: uuid,
    servings: servingsInt.optional(),
    date: isoDate.optional(),
    mealType: z.enum(MEAL_TYPES).optional(),
  })
  .refine(
    (v) => v.servings !== undefined || v.date !== undefined || v.mealType !== undefined,
    "Nothing to change.",
  );
