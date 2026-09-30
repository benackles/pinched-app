"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { FREE_LIMITS } from "@/lib/domain/constants";
import { mediaPath, parseMediaPath, validateUpload } from "@/lib/media/upload";
import { uuid } from "@/lib/validation/common";
import { requireSession } from "@/server/auth";
import { must, mustMaybe, mustOk } from "@/server/db";
import { MediaStoreError, mediaStore, type UploadTicket } from "@/server/media/store";
import { isPro } from "@/server/profile";
import { userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

/** Abuse limiter (not a product limit): upload links minted per person per day. */
const UPLOADS_PER_DAY = 40;

const requestSchema = z.object({
  recipeId: uuid,
  contentType: z.string().max(100),
  size: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
});

/** Turn a storage failure into something a person can read. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MediaStoreError) throw new ActionFailure("unknown", error.message);
    throw error;
  }
}

/**
 * Step 1 of adding a photo or video: check it is allowed and mint a short-lived upload link. The
 * browser sends the file straight to storage; nothing large passes through this server.
 */
export async function requestMediaUpload(input: z.input<typeof requestSchema>) {
  return runAction(async () => {
    const { recipeId, contentType, size } = requestSchema.parse(input);
    const checked = validateUpload({ contentType, size });
    if (!checked.ok) throw new ActionFailure("validation", checked.message);

    const session = await requireSession();
    const db = await userClient();

    const saved = mustMaybe(
      await db.from("saved_recipes").select("id").eq("recipe_id", recipeId).maybeSingle(),
    );
    if (!saved) throw new ActionFailure("not_found", "Save this recipe to add photos.");

    // Free accounts: one per recipe. The database trigger is the backstop; this fails fast,
    // before someone waits on a large upload that would be refused.
    if (!(await isPro())) {
      const existing = must(await db.from("recipe_media").select("id").eq("recipe_id", recipeId));
      if (existing.length >= FREE_LIMITS.mediaPerRecipe) {
        throw new ActionFailure("free_limit", "", { feature: "recipe_media" });
      }
    }

    const limited = await db.rpc("increment_usage", {
      p_key: `media_upload:${new Date().toISOString().slice(0, 10)}`,
      p_limit: UPLOADS_PER_DAY,
    });
    if (limited.error) {
      throw new ActionFailure("rate_limit", "You've uploaded a lot today. Try again tomorrow.");
    }

    const path = mediaPath(session.userId, recipeId, crypto.randomUUID(), checked.ext);
    const ticket: UploadTicket = await guarded(() =>
      mediaStore(db).createUpload(path, checked.contentType),
    );
    return { path, kind: checked.kind, ticket };
  });
}

const attachSchema = z.object({ recipeId: uuid, path: z.string().max(300) });

/**
 * Step 2, after the file has been uploaded: confirm what actually landed (type and size), then
 * record it on the recipe. A file that doesn't pass is removed rather than left behind.
 */
export async function attachMedia(input: z.input<typeof attachSchema>) {
  return runAction(async () => {
    const { recipeId, path } = attachSchema.parse(input);
    const session = await requireSession();
    const parsed = parseMediaPath(path);
    // The path must be ours: this person's folder, this recipe. (Storage policies enforce it too.)
    if (!parsed || parsed.userId !== session.userId || parsed.recipeId !== recipeId) {
      throw new ActionFailure("validation", "That upload doesn't belong to this recipe.");
    }

    const db = await userClient();
    const store = mediaStore(db);
    const cleanUp = () => guarded(() => store.remove([path])).catch(() => undefined);

    const stored = await guarded(() => store.info(path));
    if (!stored)
      throw new ActionFailure("not_found", "The upload didn't finish. Please try again.");
    const checked = validateUpload({ contentType: stored.contentType, size: stored.size });
    if (!checked.ok || checked.kind !== parsed.kind) {
      await cleanUp();
      throw new ActionFailure(
        "validation",
        checked.ok ? "That file doesn't match what was expected." : checked.message,
      );
    }

    try {
      mustOk(
        await db.from("recipe_media").insert({
          recipe_id: recipeId,
          kind: parsed.kind,
          storage_path: path,
        }),
      );
    } catch (error) {
      // Over the free limit, or not a recipe in their book: don't leave an orphaned file.
      await cleanUp();
      throw error;
    }
    revalidatePath(`/recipes/${recipeId}`);
    return { kind: parsed.kind };
  });
}

/** Removes a photo or video (the file first, so a failure never leaves a row pointing at nothing). */
export async function deleteMedia(input: { id: string }) {
  return runAction(async () => {
    const id = uuid.parse(input.id);
    const db = await userClient();
    const row = mustMaybe(await db.from("recipe_media").select("*").eq("id", id).maybeSingle());
    if (!row) throw new ActionFailure("not_found", "We couldn't find that photo.");

    await guarded(() => mediaStore(db).remove([row.storage_path]));
    mustOk(await db.from("recipe_media").delete().eq("id", id));
    revalidatePath(`/recipes/${row.recipe_id}`);
  });
}
