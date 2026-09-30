import { z } from "zod";

export const settingsSchema = z
  .object({
    /** ISO weekday for the prep session: Friday, Saturday, Sunday or Monday. */
    prep_day: z.union([z.literal(1), z.literal(5), z.literal(6), z.literal(7)]).optional(),
    remind_prep: z.boolean().optional(),
    remind_dinner: z.boolean().optional(),
    /** Local time of day for reminders, "HH:MM". */
    reminder_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 17:00.")
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000).startsWith("https://", "Push endpoints must be https."),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
  userAgent: z.string().max(300).nullish(),
});
