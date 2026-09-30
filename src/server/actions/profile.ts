"use server";

import { z } from "zod";

import { mustOk } from "@/server/db";
import { userClient } from "@/server/supabase";

import { runAction } from "./result";

const zoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

/** Remembers the browser's IANA time zone so reminders and "today" follow the person. */
export async function saveTimezone(zone: string) {
  return runAction(async () => {
    const timezone = zoneSchema.parse(zone);
    const db = await userClient();
    mustOk(await db.from("profiles").update({ timezone }));
  });
}
