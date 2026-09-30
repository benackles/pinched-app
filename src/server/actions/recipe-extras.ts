"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseIngredientListLossless } from "@/lib/domain/ingredients";
import type { ModifiedIngredient, RecipeChanges } from "@/lib/domain/types";
import { todayInZone } from "@/lib/domain/week";
import { uuid } from "@/lib/validation/common";
import {
  collectionNameSchema,
  cookedSchema,
  noteSchema,
  versionSchema,
} from "@/lib/validation/recipes";
import { track } from "@/server/analytics";
import { requireSession } from "@/server/auth";
import { must, mustMaybe, mustOk } from "@/server/db";
import { getTimezone } from "@/server/profile";
import { ensureSaved } from "@/server/recipes/content";
import { userClient } from "@/server/supabase";

import { ActionFailure, runAction } from "./result";

const refresh = (recipeId?: string) => {
  revalidatePath("/recipes");
  if (recipeId) revalidatePath(`/recipes/${recipeId}`);
};

// ─────────────────────────────── collections ───────────────────────────────

export async function createCollection(input: { name: string }) {
  return runAction(async () => {
    const { name } = collectionNameSchema.parse(input);
    const db = await userClient();
    const created = await db.from("collections").insert({ name }).select("id").single();
    if (created.error?.code === "23505") {
      throw new ActionFailure("conflict", "You already have a collection with that name.");
    }
    const row = must(created);
    refresh();
    return { id: row.id };
  });
}

export async function renameCollection(input: { id: string; name: string }) {
  return runAction(async () => {
    const id = uuid.parse(input.id);
    const { name } = collectionNameSchema.parse({ name: input.name });
    const db = await userClient();
    const result = await db.from("collections").update({ name }).eq("id", id).select("id");
    if (result.error?.code === "23505") {
      throw new ActionFailure("conflict", "You already have a collection with that name.");
    }
    if (must(result).length !== 1)
      throw new ActionFailure("not_found", "We couldn't find that collection.");
    revalidatePath(`/collections/${id}`);
    refresh();
  });
}

export async function deleteCollection(id: string) {
  return runAction(async () => {
    const db = await userClient();
    mustOk(await db.from("collections").delete().eq("id", uuid.parse(id)));
    refresh();
  });
}

export async function setCollectionMembership(input: {
  recipeId: string;
  collectionId: string;
  member: boolean;
}) {
  return runAction(async () => {
    const { recipeId, collectionId, member } = z
      .object({ recipeId: uuid, collectionId: uuid, member: z.boolean() })
      .parse(input);
    const db = await userClient();
    const savedId = await ensureSaved(db, recipeId);
    if (member) {
      const result = await db
        .from("collection_items")
        .insert({ collection_id: collectionId, saved_recipe_id: savedId });
      if (result.error && result.error.code !== "23505") mustOk(result);
    } else {
      mustOk(
        await db
          .from("collection_items")
          .delete()
          .eq("collection_id", collectionId)
          .eq("saved_recipe_id", savedId),
      );
    }
    revalidatePath(`/collections/${collectionId}`);
    refresh(recipeId);
  });
}

// ─────────────────────────────── notes ───────────────────────────────

export async function addNote(input: { recipeId: string; text: string }) {
  return runAction(async () => {
    const recipeId = uuid.parse(input.recipeId);
    const { text } = noteSchema.parse({ text: input.text });
    const db = await userClient();
    const savedId = await ensureSaved(db, recipeId);
    mustOk(await db.from("recipe_notes").insert({ saved_recipe_id: savedId, text }));
    refresh(recipeId);
  });
}

export async function updateNote(input: { recipeId: string; id: string; text: string }) {
  return runAction(async () => {
    const id = uuid.parse(input.id);
    const { text } = noteSchema.parse({ text: input.text });
    const db = await userClient();
    mustOk(
      await db
        .from("recipe_notes")
        .update({ text, updated_at: new Date().toISOString() })
        .eq("id", id),
    );
    refresh(uuid.parse(input.recipeId));
  });
}

export async function deleteNote(input: { recipeId: string; id: string }) {
  return runAction(async () => {
    const db = await userClient();
    mustOk(await db.from("recipe_notes").delete().eq("id", uuid.parse(input.id)));
    refresh(uuid.parse(input.recipeId));
  });
}

// ─────────────────────────────── personal version ───────────────────────────────

/**
 * Saves a personal version. The original recipe is never touched; the plan, grocery list, prep
 * plan and cook view read the version instead.
 */
export async function saveVersion(input: z.input<typeof versionSchema>) {
  return runAction(async () => {
    const data = versionSchema.parse(input);
    const db = await userClient();
    const savedId = await ensureSaved(db, data.recipeId);

    const ingredients: ModifiedIngredient[] = parseIngredientListLossless(data.ingredients).map(
      (ingredient) => ({
        quantity: ingredient.quantity,
        quantity_max: ingredient.quantity_max,
        unit: ingredient.unit,
        name: ingredient.name,
        preparation: ingredient.preparation,
        raw_text: ingredient.raw_text,
        grocery_section: ingredient.grocery_section,
      }),
    );
    const changes: RecipeChanges = {
      title: data.title,
      servings: data.servings,
      total_minutes: data.total_minutes,
      ingredients,
      steps: data.steps,
    };
    mustOk(
      await db
        .from("recipe_modifications")
        .upsert(
          { saved_recipe_id: savedId, changes, updated_at: new Date().toISOString() },
          { onConflict: "user_id,saved_recipe_id" },
        ),
    );
    refresh(data.recipeId);
    revalidatePath("/plan");
    revalidatePath("/grocery-list");
    revalidatePath("/prep");
  });
}

export async function resetVersion(recipeId: string) {
  return runAction(async () => {
    const id = uuid.parse(recipeId);
    const db = await userClient();
    const saved = mustMaybe(
      await db.from("saved_recipes").select("id").eq("recipe_id", id).maybeSingle(),
    );
    if (saved)
      mustOk(await db.from("recipe_modifications").delete().eq("saved_recipe_id", saved.id));
    refresh(id);
    revalidatePath("/plan");
    revalidatePath("/grocery-list");
    revalidatePath("/prep");
  });
}

// ─────────────────────────────── cooking history ───────────────────────────────

/** Mark cooked: rating and note go to the history; the rating also becomes the recipe's rating. */
export async function logCooked(input: z.input<typeof cookedSchema>) {
  return runAction(async () => {
    const data = cookedSchema.parse(input);
    const db = await userClient();
    const timezone = await getTimezone();
    const savedId = await ensureSaved(db, data.recipeId);

    // A planned meal id is only kept when it is really the person's own (the FK alone would not say).
    let plannedMealId: string | null = null;
    if (data.plannedMealId) {
      const meal = mustMaybe(
        await db.from("planned_meals").select("id").eq("id", data.plannedMealId).maybeSingle(),
      );
      plannedMealId = meal?.id ?? null;
    }

    const cookedAt =
      data.cookedOn === todayInZone(timezone)
        ? new Date().toISOString()
        : `${data.cookedOn}T12:00:00.000Z`;
    const event = must(
      await db
        .from("cooking_events")
        .insert({
          saved_recipe_id: savedId,
          planned_meal_id: plannedMealId,
          cooked_at: cookedAt,
          rating: data.rating ?? null,
          note: data.note || null,
        })
        .select("id")
        .single(),
    );
    if (data.rating) {
      mustOk(
        await db.from("saved_recipes").update({ personal_rating: data.rating }).eq("id", savedId),
      );
    }
    await track((await requireSession()).userId, "cooked_logged", { rated: Boolean(data.rating) });
    refresh(data.recipeId);
    revalidatePath("/plan");
    return { eventId: event.id };
  });
}
