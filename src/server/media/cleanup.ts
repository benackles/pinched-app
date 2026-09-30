import "server-only";

import { must } from "@/server/db";
import type { Supabase } from "@/server/supabase";

import { mediaStore, type MediaStore } from "./store";

const CHUNK = 100;

/** Removes objects in batches. Throws if storage refuses, so callers never drop rows they can't clean up after. */
export async function removeObjects(store: MediaStore, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += CHUNK) await store.remove(paths.slice(i, i + CHUNK));
}

/**
 * Deletes the files behind every photo and video attached to a recipe. Files go first: if storage
 * is down the caller fails and can retry, instead of leaving files nobody can see or remove.
 */
export async function removeRecipeMediaFiles(db: Supabase, recipeId: string): Promise<void> {
  const rows = must(await db.from("recipe_media").select("storage_path").eq("recipe_id", recipeId));
  await removeObjects(
    mediaStore(db),
    rows.map((row) => row.storage_path),
  );
}
