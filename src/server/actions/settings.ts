"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { pushSubscriptionSchema, settingsSchema } from "@/lib/validation/settings";
import { track } from "@/server/analytics";
import { requireSession } from "@/server/auth";
import { mustOk } from "@/server/db";
import { isPro } from "@/server/profile";
import { adminClient, userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

/** Prep day and reminder preferences. Column privileges keep billing and identity columns out of reach. */
export async function updateSettings(input: z.input<typeof settingsSchema>) {
  return runAction(async () => {
    const patch = settingsSchema.parse(input);
    const session = await requireSession();
    const db = await userClient();
    mustOk(
      await db
        .from("profiles")
        .update({
          ...patch,
          ...(patch.reminder_time ? { reminder_time: `${patch.reminder_time}:00` } : {}),
        })
        .eq("user_id", session.userId),
    );
    revalidatePath("/settings");
    revalidatePath("/prep");
  });
}

/**
 * Registers this device for reminders (Pro only). A push endpoint belongs to one browser profile,
 * so if the same device was used by someone else it is reassigned to the signed-in person.
 */
export async function savePushSubscription(input: z.input<typeof pushSubscriptionSchema>) {
  return runAction(async () => {
    const data = pushSubscriptionSchema.parse(input);
    const session = await requireSession();
    if (!(await isPro())) {
      throw new ActionFailure("free_limit", "Reminders are part of Pinched Pro.", {
        feature: "push_reminders",
      });
    }
    // Service role, but the user id comes from the verified session — never from the request.
    const admin = adminClient();
    mustOk(await admin.from("push_subscriptions").delete().eq("endpoint", data.endpoint));
    mustOk(
      await admin.from("push_subscriptions").insert({
        user_id: session.userId,
        endpoint: data.endpoint,
        keys: data.keys,
        user_agent: data.userAgent ?? null,
      }),
    );
    await track(session.userId, "push_enabled", {});
    revalidatePath("/settings");
  });
}

export async function removePushSubscription(input: { endpoint: string }) {
  return runAction(async () => {
    const endpoint = z.url().parse(input.endpoint);
    const db = await userClient();
    mustOk(await db.from("push_subscriptions").delete().eq("endpoint", endpoint));
    revalidatePath("/settings");
  });
}
