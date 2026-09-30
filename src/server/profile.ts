import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { requireSession } from "./auth";
import { must, mustOk } from "./db";
import { userClient } from "./supabase";

export type ProfileView = {
  user_id: string;
  email: string | null;
  name: string | null;
  prep_day: number;
  reminder_time: string;
  timezone: string | null;
  remind_prep: boolean;
  remind_dinner: boolean;
};

const PROFILE_COLUMNS =
  "user_id, email, name, prep_day, reminder_time, timezone, remind_prep, remind_dinner";

export const TIMEZONE_COOKIE = "pinched_tz";

/**
 * The signed-in user's profile row. Normally created by the Clerk webhook on sign-up; if it is
 * missing (webhook delayed, local mode) it is created here under the user's own RLS policy.
 */
export const getProfile = cache(async (): Promise<ProfileView> => {
  const session = await requireSession();
  const db = await userClient();

  const existing = await db.from("profiles").select(PROFILE_COLUMNS).maybeSingle();
  if (existing.data) return existing.data;

  const identity = await session.identity();
  mustOk(
    await db
      .from("profiles")
      .upsert(
        { email: identity.email, name: identity.name },
        { onConflict: "user_id", ignoreDuplicates: true },
      ),
  );
  return must(await db.from("profiles").select(PROFILE_COLUMNS).single());
});

function validZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The person's own clock: cookie set by the browser, else the saved profile zone, else UTC. */
export async function getTimezone(profile?: Pick<ProfileView, "timezone">): Promise<string> {
  const jar = await cookies();
  return (
    validZone(jar.get(TIMEZONE_COOKIE)?.value) ??
    validZone(profile?.timezone ?? undefined) ??
    validZone((await getProfile()).timezone ?? undefined) ??
    "UTC"
  );
}

/** Pro = active, trialing or past-due subscription. Answered by the database, for the signed-in user only. */
export const isPro = cache(async (): Promise<boolean> => {
  const db = await userClient();
  const { data } = await db.rpc("is_pro");
  return data === true;
});
