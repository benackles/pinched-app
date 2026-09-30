import "server-only";

import type { Supabase } from "@/server/supabase";
import { mustOk } from "@/server/db";

export type ClerkUserData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string }[];
};

export type ClerkUserEvent =
  | { type: "user.created" | "user.updated"; data: ClerkUserData }
  | { type: "user.deleted"; data: { id?: string | null; deleted?: boolean } };

const displayName = (first?: string | null, last?: string | null) =>
  [first, last].filter(Boolean).join(" ") || null;

function primaryEmail(data: ClerkUserData) {
  const list = data.email_addresses ?? [];
  return (
    list.find((e) => e.id === data.primary_email_address_id)?.email_address ??
    list[0]?.email_address ??
    null
  );
}

/** Everything a person owns, removed. Roots are deleted and foreign keys cascade to the rest. */
export async function purgeUserData(admin: Supabase, userId: string): Promise<void> {
  // Uploaded photos and videos live in Storage, in the person's own folder.
  const { data: media } = await admin
    .from("recipe_media")
    .select("storage_path")
    .eq("user_id", userId);
  const paths = (media ?? []).map((m) => m.storage_path);
  if (paths.length) await admin.storage.from("recipe-media").remove(paths);

  mustOk(await admin.from("weekly_plans").delete().eq("user_id", userId)); // meals, lists, prep plans…
  mustOk(await admin.from("saved_recipes").delete().eq("user_id", userId)); // notes, versions, history…
  mustOk(await admin.from("collections").delete().eq("user_id", userId));
  mustOk(await admin.from("recipe_media").delete().eq("user_id", userId));
  mustOk(await admin.from("recipes").delete().eq("owner_id", userId)); // their own recipes
  mustOk(await admin.from("kitchen_items").delete().eq("user_id", userId));
  mustOk(await admin.from("push_subscriptions").delete().eq("user_id", userId));
  mustOk(await admin.from("push_deliveries").delete().eq("user_id", userId));
  mustOk(await admin.from("prep_edit_log").delete().eq("user_id", userId));
  mustOk(await admin.from("usage_counters").delete().eq("user_id", userId));
  mustOk(await admin.from("subscriptions").delete().eq("user_id", userId));
  mustOk(await admin.from("profiles").delete().eq("user_id", userId));
}

/** Clerk → profiles. The event is already signature-verified by the route. */
export async function handleClerkEvent(
  event: ClerkUserEvent,
  deps: { admin: Supabase; cancelSubscriptions?: (userId: string) => Promise<void> },
): Promise<{ handled: boolean; detail: string }> {
  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const { id } = event.data;
      mustOk(
        await deps.admin.from("profiles").upsert(
          {
            user_id: id,
            email: primaryEmail(event.data),
            name: displayName(event.data.first_name, event.data.last_name),
          },
          { onConflict: "user_id" },
        ),
      );
      return { handled: true, detail: event.type };
    }
    case "user.deleted": {
      const id = event.data.id;
      if (!id) return { handled: false, detail: "no user id" };
      // Stop billing first; if that fails the error surfaces and Clerk retries the webhook.
      await deps.cancelSubscriptions?.(id);
      await purgeUserData(deps.admin, id);
      return { handled: true, detail: "user data deleted" };
    }
  }
}
