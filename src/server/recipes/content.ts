import "server-only";

import { parseIngredientListLossless } from "@/lib/domain/ingredients";
import type { RecipeFormData } from "@/lib/validation/recipes";
import { must, mustMaybe, mustOk } from "@/server/db";
import type { Supabase } from "@/server/supabase";

/** Saves a recipe in the person's book (once), returning the saved-recipe id. */
export async function ensureSaved(db: Supabase, recipeId: string): Promise<string> {
  const existing = mustMaybe(
    await db.from("saved_recipes").select("id").eq("recipe_id", recipeId).maybeSingle(),
  );
  if (existing) return existing.id;
  const created = await db
    .from("saved_recipes")
    .insert({ recipe_id: recipeId })
    .select("id")
    .single();
  if (created.error?.code === "23505") {
    return must(await db.from("saved_recipes").select("id").eq("recipe_id", recipeId).single()).id;
  }
  return must(created).id;
}

const totalMinutes = (data: Pick<RecipeFormData, "prep_minutes" | "cook_minutes">) =>
  data.prep_minutes === null && data.cook_minutes === null
    ? null
    : (data.prep_minutes ?? 0) + (data.cook_minutes ?? 0);

function recipeColumns(data: RecipeFormData) {
  return {
    title: data.title,
    author: data.author,
    source_url: data.source_url,
    image_url: data.image_url,
    servings: data.servings,
    servings_label: data.servings_label,
    prep_minutes: data.prep_minutes,
    cook_minutes: data.cook_minutes,
    total_minutes: totalMinutes(data),
  };
}

async function writeContent(db: Supabase, recipeId: string, data: RecipeFormData): Promise<void> {
  const ingredients = parseIngredientListLossless(data.ingredients);
  mustOk(
    await db.from("ingredients").insert(
      ingredients.map((ingredient, index) => ({
        recipe_id: recipeId,
        sort_order: index,
        quantity: ingredient.quantity,
        quantity_max: ingredient.quantity_max,
        unit: ingredient.unit,
        name: ingredient.name,
        normalized_name: ingredient.normalized_name,
        preparation: ingredient.preparation,
        raw_text: ingredient.raw_text,
        grocery_section: ingredient.grocery_section,
        group_label: ingredient.group_label,
      })),
    ),
  );
  mustOk(
    await db.from("recipe_steps").insert(
      data.steps.map((instruction, index) => ({
        recipe_id: recipeId,
        step_number: index + 1,
        instruction,
      })),
    ),
  );
}

/**
 * Creates a recipe the person owns (manual entry or URL import) and puts it in their book.
 * There is no multi-request transaction over PostgREST, so a failure part-way (for example the
 * free-tier saved-recipes limit) removes the half-built recipe again.
 */
export async function createOwnRecipe(
  db: Supabase,
  source: "manual" | "url_import",
  data: RecipeFormData,
): Promise<string> {
  const recipe = must(
    await db
      .from("recipes")
      .insert({ source, ...recipeColumns(data), tags: [] })
      .select("id")
      .single(),
  );
  try {
    await writeContent(db, recipe.id, data);
    mustOk(await db.from("saved_recipes").insert({ recipe_id: recipe.id }));
  } catch (error) {
    await db.from("recipes").delete().eq("id", recipe.id);
    throw error;
  }
  return recipe.id;
}

/** Replaces the content of a recipe the person owns. RLS refuses anyone else's and all catalog recipes. */
export async function replaceOwnRecipe(
  db: Supabase,
  recipeId: string,
  data: RecipeFormData,
): Promise<void> {
  const updated = must(
    await db.from("recipes").update(recipeColumns(data)).eq("id", recipeId).select("id"),
  );
  if (updated.length !== 1) throw new Error("not_found");
  mustOk(await db.from("ingredients").delete().eq("recipe_id", recipeId));
  mustOk(await db.from("recipe_steps").delete().eq("recipe_id", recipeId));
  await writeContent(db, recipeId, data);
}
