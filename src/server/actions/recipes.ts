"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isLocalMode } from "@/lib/auth/config";
import { FREE_LIMITS, RECIPE_SOURCES } from "@/lib/domain/constants";
import { monthKey, todayInZone } from "@/lib/domain/week";
import { EMPTY_DRAFT, formatIngredientLines, type RecipeDraft } from "@/lib/recipes/draft";
import { dnsResolver, nodeTransport } from "@/lib/recipe-import/transport";
import { importRecipe } from "@/lib/recipe-import/import";
import { importUrlSchema, recipeFormSchema } from "@/lib/validation/recipes";
import { uuid } from "@/lib/validation/common";
import { track } from "@/server/analytics";
import { requireSession } from "@/server/auth";
import { must, mustMaybe, mustOk } from "@/server/db";
import { removeRecipeMediaFiles } from "@/server/media/cleanup";
import { getTimezone, isPro } from "@/server/profile";
import { createOwnRecipe, ensureSaved, replaceOwnRecipe } from "@/server/recipes/content";
import { userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

/** The site a link points at ("example.com"), for analytics. */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
};

const refreshRecipes = (recipeId?: string) => {
  revalidatePath("/recipes");
  if (recipeId) revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/plan");
};

/** Puts a recipe in the person's book. Free accounts are capped at 25 (enforced in the database too). */
export async function saveRecipe(recipeId: string) {
  return runAction(async () => {
    const id = uuid.parse(recipeId);
    const db = await userClient();
    const savedId = await ensureSaved(db, id);
    const recipe = mustMaybe(await db.from("recipes").select("source").eq("id", id).maybeSingle());
    const source = RECIPE_SOURCES.find((known) => known === recipe?.source);
    if (source) await track((await requireSession()).userId, "recipe_saved", { source });
    refreshRecipes(id);
    return { savedId };
  });
}

/** Removes a recipe from the book. Its planned meals and everything generated from them go with it. */
export async function unsaveRecipe(recipeId: string) {
  return runAction(async () => {
    const id = uuid.parse(recipeId);
    const db = await userClient();
    // Photos and video are part of the person's copy: they go with it (files first).
    await removeRecipeMediaFiles(db, id);
    mustOk(await db.from("recipe_media").delete().eq("recipe_id", id));
    mustOk(await db.from("saved_recipes").delete().eq("recipe_id", id));
    refreshRecipes(id);
    revalidatePath("/grocery-list");
    revalidatePath("/prep");
  });
}

const ratingSchema = z.object({
  recipeId: uuid,
  rating: z.number().int().min(1).max(5).nullable(),
});

/** Rating a recipe saves it to the book (like the prototype). Passing null clears the rating. */
export async function rateRecipe(input: z.input<typeof ratingSchema>) {
  return runAction(async () => {
    const { recipeId, rating } = ratingSchema.parse(input);
    const db = await userClient();
    const savedId = await ensureSaved(db, recipeId);
    mustOk(await db.from("saved_recipes").update({ personal_rating: rating }).eq("id", savedId));
    refreshRecipes(recipeId);
    return { savedId };
  });
}

export async function setFavorite(input: { recipeId: string; favorite: boolean }) {
  return runAction(async () => {
    const { recipeId, favorite } = z.object({ recipeId: uuid, favorite: z.boolean() }).parse(input);
    const db = await userClient();
    const savedId = await ensureSaved(db, recipeId);
    mustOk(await db.from("saved_recipes").update({ favorite }).eq("id", savedId));
    refreshRecipes(recipeId);
  });
}

// ─────────────────────────────── manual entry ───────────────────────────────

export async function createManualRecipe(input: z.input<typeof recipeFormSchema>) {
  return runAction(async () => {
    const data = recipeFormSchema.parse(input);
    const db = await userClient();
    const recipeId = await createOwnRecipe(db, "manual", data);
    await track((await requireSession()).userId, "recipe_saved", { source: "manual" });
    refreshRecipes(recipeId);
    return { recipeId };
  });
}

export async function updateOwnRecipe(recipeId: string, input: z.input<typeof recipeFormSchema>) {
  return runAction(async () => {
    const id = uuid.parse(recipeId);
    const data = recipeFormSchema.parse(input);
    const db = await userClient();
    try {
      await replaceOwnRecipe(db, id, data);
    } catch (error) {
      if (error instanceof Error && error.message === "not_found") {
        throw new ActionFailure("not_found", "You can only edit recipes you added yourself.");
      }
      throw error;
    }
    refreshRecipes(id);
    revalidatePath("/grocery-list");
    revalidatePath("/prep");
    return { recipeId: id };
  });
}

/** Deletes a recipe the person added (and, with it, anything planned from it). */
export async function deleteOwnRecipe(recipeId: string) {
  return runAction(async () => {
    const id = uuid.parse(recipeId);
    const db = await userClient();
    // Only your own recipes can be deleted; clear their photo files first (the rows cascade).
    const session = await requireSession();
    const own = mustMaybe(
      await db
        .from("recipes")
        .select("id")
        .eq("id", id)
        .eq("owner_id", session.userId)
        .maybeSingle(),
    );
    if (own) await removeRecipeMediaFiles(db, id);
    const deleted = must(await db.from("recipes").delete().eq("id", id).select("id"));
    if (deleted.length !== 1) {
      throw new ActionFailure("not_found", "You can only delete recipes you added yourself.");
    }
    refreshRecipes();
    revalidatePath("/grocery-list");
    revalidatePath("/prep");
  });
}

// ─────────────────────────────── URL import ───────────────────────────────

export type ImportPreview =
  | {
      kind: "recipe";
      draft: RecipeDraft;
      warnings: string[];
      existingRecipeId: string | null;
    }
  | {
      kind: "manual";
      draft: RecipeDraft;
      message: string;
      existingRecipeId: string | null;
    };

const IMPORT_PREVIEWS_PER_DAY = 40;

const emptyDraft = (overrides: Partial<RecipeDraft> = {}): RecipeDraft => ({
  ...EMPTY_DRAFT,
  ...overrides,
});

async function existingImport(
  db: Awaited<ReturnType<typeof userClient>>,
  sourceUrl: string,
): Promise<string | null> {
  const row = mustMaybe(
    await db
      .from("recipes")
      .select("id")
      .eq("source", "url_import")
      .eq("source_url", sourceUrl)
      .maybeSingle(),
  );
  return row?.id ?? null;
}

/**
 * Fetches ONE page the person chose (server-side only) and returns a preview they can edit and
 * confirm. Nothing is saved here. Free accounts get 5 imports a month; every account is also
 * rate-limited so the fetcher can't be used as a proxy.
 */
export async function previewImport(input: { url: string }) {
  return runAction(async (): Promise<ImportPreview> => {
    const { url } = importUrlSchema.parse(input);
    const db = await userClient();
    const timezone = await getTimezone();

    const pro = await isPro();
    if (!pro) {
      const counter = mustMaybe(
        await db
          .from("usage_counters")
          .select("count")
          .eq("key", `url_import:${monthKey(timezone)}`)
          .maybeSingle(),
      );
      if ((counter?.count ?? 0) >= FREE_LIMITS.urlImportsPerMonth) {
        throw new ActionFailure("free_limit", "", { feature: "url_import" });
      }
    }
    // Abuse limiter, not a product limit: a day's worth of previews for everyone.
    const { error } = await db.rpc("increment_usage", {
      p_key: `import_preview:${todayInZone(timezone)}`,
      p_limit: IMPORT_PREVIEWS_PER_DAY,
    });
    if (error) {
      throw new ActionFailure(
        "rate_limit",
        "You've previewed a lot of links today. Try again tomorrow.",
        {
          feature: "import_preview",
        },
      );
    }

    const result = await importRecipe(url, {
      transport: nodeTransport,
      resolve: dnsResolver,
      // Only the credential-free demo backend and its tests may fetch from private addresses.
      allowPrivate: isLocalMode() && process.env.PINCHED_IMPORT_ALLOW_PRIVATE === "1",
    });

    if (!result.ok) {
      const prefill = result.prefill;
      return {
        kind: "manual",
        message: result.message,
        existingRecipeId: prefill ? await existingImport(db, prefill.source_url) : null,
        draft: emptyDraft({ title: prefill?.title ?? "", source_url: prefill?.source_url ?? url }),
      };
    }

    const r = result.recipe;
    return {
      kind: "recipe",
      warnings: r.warnings,
      existingRecipeId: await existingImport(db, r.source_url),
      draft: {
        title: r.title,
        author: r.author ?? "",
        source_url: r.source_url,
        image_url: r.image_url ?? "",
        servings: r.servings === null ? "" : String(r.servings),
        servings_label: r.servings_label ?? "",
        prep_minutes: r.prep_minutes === null ? "" : String(r.prep_minutes),
        cook_minutes: r.cook_minutes === null ? "" : String(r.cook_minutes),
        ingredients: formatIngredientLines(r.ingredients),
        steps: r.steps.join("\n"),
      },
    };
  });
}

/** Saves a previewed (and possibly edited) import. The source URL is kept and the author credited. */
export async function confirmImport(input: z.input<typeof recipeFormSchema>) {
  return runAction(async () => {
    const data = recipeFormSchema.parse(input);
    if (!data.source_url) throw new ActionFailure("validation", "An import needs its source link.");
    const db = await userClient();
    const timezone = await getTimezone();

    const existing = await existingImport(db, data.source_url);
    if (existing) return { recipeId: existing, alreadyImported: true };

    const recipeId = await createOwnRecipe(db, "url_import", data);
    // Count it only now that it saved; past the free limit the database raises and we undo the import.
    const pro = await isPro();
    const counted = await db.rpc("increment_usage", {
      p_key: `url_import:${monthKey(timezone)}`,
      p_limit: pro ? undefined : FREE_LIMITS.urlImportsPerMonth,
    });
    if (counted.error) {
      await db.from("recipes").delete().eq("id", recipeId);
      throw new ActionFailure("free_limit", "", { feature: "url_import" });
    }
    const userId = (await requireSession()).userId;
    await track(userId, "recipe_saved", { source: "url_import" });
    await track(userId, "recipe_imported", { host: hostOf(data.source_url) });
    refreshRecipes(recipeId);
    return { recipeId, alreadyImported: false };
  });
}
