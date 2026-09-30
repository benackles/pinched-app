import "server-only";

import type { Row } from "@/db/types";
import { likeEscape, pgrstQuote } from "@/lib/format";
import type { CatalogFilters, RecipeCardData, RecipeSource } from "@/lib/recipes/types";
import { must, mustMaybe } from "@/server/db";
import type { Supabase } from "@/server/supabase";

const CARD_COLUMNS = "id, source, title, author, image_url, total_minutes, servings, tags";

type CardRecipe = Pick<
  Row<"recipes">,
  "id" | "source" | "title" | "author" | "image_url" | "total_minutes" | "servings" | "tags"
>;

const unique = <T>(values: T[]) => [...new Set(values)];

function toCard(
  recipe: CardRecipe,
  saved?: Pick<Row<"saved_recipes">, "id" | "favorite" | "personal_rating"> | undefined,
  extras: { cookedCount?: number; collectionIds?: string[] } = {},
): RecipeCardData {
  return {
    id: recipe.id,
    source: recipe.source as RecipeSource,
    title: recipe.title,
    author: recipe.author,
    imageUrl: recipe.image_url,
    totalMinutes: recipe.total_minutes,
    servings: recipe.servings,
    tags: recipe.tags,
    savedId: saved?.id ?? null,
    rating: saved?.personal_rating ?? null,
    favorite: saved?.favorite ?? false,
    cookedCount: extras.cookedCount ?? 0,
    collectionIds: extras.collectionIds ?? [],
  };
}

/** Published catalog recipes, filtered by text (title or ingredient) and tag. */
export async function searchCatalog(
  db: Supabase,
  filters: CatalogFilters = {},
): Promise<RecipeCardData[]> {
  let request = db
    .from("recipes")
    .select(CARD_COLUMNS)
    .eq("source", "seeded")
    .not("published_at", "is", null)
    .order("title")
    .limit(200);

  const q = filters.q?.trim();
  if (q) {
    const pattern = `%${likeEscape(q)}%`;
    const byIngredient = must(
      await db
        .from("ingredients")
        .select("recipe_id")
        .is("owner_id", null)
        .ilike("normalized_name", pattern)
        .limit(1000),
    );
    const ids = unique(byIngredient.map((row) => row.recipe_id));
    const terms = [`title.ilike.${pgrstQuote(pattern)}`];
    if (ids.length) terms.push(`id.in.(${ids.join(",")})`);
    request = request.or(terms.join(","));
  }
  if (filters.tag) request = request.contains("tags", [filters.tag]);

  const recipes = must(await request);
  if (recipes.length === 0) return [];

  const saved = must(
    await db
      .from("saved_recipes")
      .select("id, recipe_id, favorite, personal_rating")
      .in(
        "recipe_id",
        recipes.map((r) => r.id),
      ),
  );
  const savedByRecipe = new Map(saved.map((s) => [s.recipe_id, s]));
  return recipes.map((recipe) => toCard(recipe, savedByRecipe.get(recipe.id)));
}

/** The person's recipe book, newest first, with cooking counts and collection memberships. */
export async function listSavedRecipes(db: Supabase): Promise<RecipeCardData[]> {
  const saved = must(
    await db.from("saved_recipes").select("*").order("saved_at", { ascending: false }),
  );
  if (saved.length === 0) return [];

  const [recipes, cooking, items] = await Promise.all([
    db
      .from("recipes")
      .select(CARD_COLUMNS)
      .in(
        "id",
        saved.map((s) => s.recipe_id),
      ),
    db.from("cooking_events").select("saved_recipe_id"),
    db.from("collection_items").select("collection_id, saved_recipe_id"),
  ]);
  const recipeById = new Map(must(recipes).map((r) => [r.id, r]));
  const cooked = new Map<string, number>();
  for (const event of must(cooking)) {
    cooked.set(event.saved_recipe_id, (cooked.get(event.saved_recipe_id) ?? 0) + 1);
  }
  const collectionsBySaved = new Map<string, string[]>();
  for (const item of must(items)) {
    const list = collectionsBySaved.get(item.saved_recipe_id) ?? [];
    list.push(item.collection_id);
    collectionsBySaved.set(item.saved_recipe_id, list);
  }

  const cards: RecipeCardData[] = [];
  for (const row of saved) {
    const recipe = recipeById.get(row.recipe_id);
    if (!recipe) continue; // no longer readable
    cards.push(
      toCard(recipe, row, {
        cookedCount: cooked.get(row.id) ?? 0,
        collectionIds: collectionsBySaved.get(row.id) ?? [],
      }),
    );
  }
  return cards;
}

export type CollectionSummary = {
  id: string;
  name: string;
  count: number;
  coverImage: string | null;
};

export async function listCollections(db: Supabase): Promise<CollectionSummary[]> {
  const [collections, items] = await Promise.all([
    db.from("collections").select("*").order("name"),
    db
      .from("collection_items")
      .select("collection_id, saved_recipe_id, added_at")
      .order("added_at"),
  ]);
  const rows = must(collections);
  const links = must(items);
  if (rows.length === 0) return [];

  const savedIds = unique(links.map((l) => l.saved_recipe_id));
  const cover = new Map<string, string | null>();
  if (savedIds.length) {
    const saved = must(await db.from("saved_recipes").select("id, recipe_id").in("id", savedIds));
    const recipes = must(
      await db
        .from("recipes")
        .select("id, image_url")
        .in(
          "id",
          saved.map((s) => s.recipe_id),
        ),
    );
    const imageByRecipe = new Map(recipes.map((r) => [r.id, r.image_url]));
    const recipeBySaved = new Map(saved.map((s) => [s.id, s.recipe_id]));
    for (const link of links) {
      if (cover.get(link.collection_id)) continue;
      const image = imageByRecipe.get(recipeBySaved.get(link.saved_recipe_id) ?? "");
      if (image) cover.set(link.collection_id, image);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: links.filter((l) => l.collection_id === row.id).length,
    coverImage: cover.get(row.id) ?? null,
  }));
}

export async function getCollectionDetail(db: Supabase, id: string) {
  const collection = mustMaybe(await db.from("collections").select("*").eq("id", id).maybeSingle());
  if (!collection) return null;
  const all = await listSavedRecipes(db);
  return { collection, recipes: all.filter((card) => card.collectionIds.includes(id)) };
}

export type RecipeDetail = {
  recipe: Row<"recipes">;
  isOwner: boolean;
  ingredients: Row<"ingredients">[];
  steps: Row<"recipe_steps">[];
  saved: Row<"saved_recipes"> | null;
  modification: Row<"recipe_modifications"> | null;
  notes: Row<"recipe_notes">[];
  cooking: Row<"cooking_events">[];
  collections: Row<"collections">[];
  memberOf: string[];
  media: Row<"recipe_media">[];
  planned: { id: string; planned_date: string; meal_type: string; servings: number }[];
};

export async function getRecipeDetail(
  db: Supabase,
  recipeId: string,
  userId: string,
  fromDate: string,
): Promise<RecipeDetail | null> {
  const recipe = mustMaybe(await db.from("recipes").select("*").eq("id", recipeId).maybeSingle());
  if (!recipe) return null;

  const [ingredients, steps, saved, collections, media] = await Promise.all([
    db.from("ingredients").select("*").eq("recipe_id", recipeId).order("sort_order"),
    db.from("recipe_steps").select("*").eq("recipe_id", recipeId).order("step_number"),
    db.from("saved_recipes").select("*").eq("recipe_id", recipeId).maybeSingle(),
    db.from("collections").select("*").order("name"),
    db.from("recipe_media").select("*").eq("recipe_id", recipeId).order("created_at"),
  ]);
  const savedRow = mustMaybe(saved);

  let modification: Row<"recipe_modifications"> | null = null;
  let notes: Row<"recipe_notes">[] = [];
  let cooking: Row<"cooking_events">[] = [];
  let memberOf: string[] = [];
  let planned: RecipeDetail["planned"] = [];
  if (savedRow) {
    const [mod, noteRows, events, links, meals] = await Promise.all([
      db.from("recipe_modifications").select("*").eq("saved_recipe_id", savedRow.id).maybeSingle(),
      db
        .from("recipe_notes")
        .select("*")
        .eq("saved_recipe_id", savedRow.id)
        .order("created_at", { ascending: false }),
      db
        .from("cooking_events")
        .select("*")
        .eq("saved_recipe_id", savedRow.id)
        .order("cooked_at", { ascending: false }),
      db.from("collection_items").select("collection_id").eq("saved_recipe_id", savedRow.id),
      db
        .from("planned_meals")
        .select("id, planned_date, meal_type, servings")
        .eq("saved_recipe_id", savedRow.id)
        .gte("planned_date", fromDate)
        .order("planned_date")
        .limit(6),
    ]);
    modification = mustMaybe(mod);
    notes = must(noteRows);
    cooking = must(events);
    memberOf = must(links).map((l) => l.collection_id);
    planned = must(meals);
  }

  return {
    recipe,
    isOwner: recipe.owner_id === userId,
    ingredients: must(ingredients),
    steps: must(steps),
    saved: savedRow,
    modification,
    notes,
    cooking,
    collections: must(collections),
    memberOf,
    media: must(media),
    planned,
  };
}

/** Saved-recipe picker for "Add meal": the book first, then the catalog. */
export async function pickerRecipes(db: Supabase): Promise<RecipeCardData[]> {
  const [book, catalog] = await Promise.all([listSavedRecipes(db), searchCatalog(db)]);
  const inBook = new Set(book.map((b) => b.id));
  return [...book, ...catalog.filter((c) => !inBook.has(c.id))];
}
