import "server-only";

import { applyModification } from "@/lib/domain/recipe-modification";
import { isScalable } from "@/lib/domain/scaling";
import type { MealType } from "@/lib/domain/constants";
import type {
  MealInput,
  PlannableRecipe,
  RecipeChanges,
  RecipeIngredientRow,
} from "@/lib/domain/types";
import type { Row } from "@/db/types";
import { must, mustMaybe } from "@/server/db";
import type { Supabase } from "@/server/supabase";

export type WeekMeal = {
  id: string;
  weekly_plan_id: string;
  saved_recipe_id: string;
  recipe_id: string;
  planned_date: string;
  meal_type: MealType;
  servings: number;
  sort_order: number;
  /** Display title with the personal version applied. */
  title: string;
  image_url: string | null;
  total_minutes: number | null;
  recipe_servings: number | null;
  scalable: boolean;
  has_version: boolean;
  /** The recipe the planner works with — personal version already applied. */
  recipe: PlannableRecipe;
};

export type WeekContext = {
  weekStart: string;
  plan: Row<"weekly_plans"> | null;
  meals: WeekMeal[];
};

const inList = <T>(values: T[]) => [...new Set(values)];

/** The plan for one week with every planned meal's recipe loaded (personal versions applied). */
export async function loadWeekContext(db: Supabase, weekStart: string): Promise<WeekContext> {
  const plan = mustMaybe(
    await db.from("weekly_plans").select("*").eq("week_start_date", weekStart).maybeSingle(),
  );
  if (!plan) return { weekStart, plan: null, meals: [] };

  const mealRows = must(
    await db
      .from("planned_meals")
      .select("*")
      .eq("weekly_plan_id", plan.id)
      .order("planned_date")
      .order("sort_order")
      .order("created_at"),
  );
  if (mealRows.length === 0) return { weekStart, plan, meals: [] };

  const savedIds = inList(mealRows.map((m) => m.saved_recipe_id));
  const saved = must(await db.from("saved_recipes").select("id, recipe_id").in("id", savedIds));
  const recipeIds = inList(saved.map((s) => s.recipe_id));

  const [recipes, ingredients, steps, modifications] = await Promise.all([
    db.from("recipes").select("*").in("id", recipeIds),
    db.from("ingredients").select("*").in("recipe_id", recipeIds).order("sort_order"),
    db.from("recipe_steps").select("*").in("recipe_id", recipeIds).order("step_number"),
    db
      .from("recipe_modifications")
      .select("saved_recipe_id, changes")
      .in("saved_recipe_id", savedIds),
  ]);

  const recipeById = new Map(must(recipes).map((r) => [r.id, r]));
  const recipeIdBySaved = new Map(saved.map((s) => [s.id, s.recipe_id]));
  const changesBySaved = new Map(
    must(modifications).map((m) => [m.saved_recipe_id, m.changes as RecipeChanges]),
  );
  const ingredientsByRecipe = new Map<string, RecipeIngredientRow[]>();
  for (const row of must(ingredients)) {
    const list = ingredientsByRecipe.get(row.recipe_id) ?? [];
    list.push({
      id: row.id,
      sort_order: row.sort_order,
      quantity: row.quantity,
      quantity_max: row.quantity_max,
      unit: row.unit,
      name: row.name,
      normalized_name: row.normalized_name,
      preparation: row.preparation,
      raw_text: row.raw_text,
      grocery_section: row.grocery_section as RecipeIngredientRow["grocery_section"],
    });
    ingredientsByRecipe.set(row.recipe_id, list);
  }
  const stepsByRecipe = new Map<string, { step_number: number; instruction: string }[]>();
  for (const row of must(steps)) {
    const list = stepsByRecipe.get(row.recipe_id) ?? [];
    list.push({ step_number: row.step_number, instruction: row.instruction });
    stepsByRecipe.set(row.recipe_id, list);
  }

  const meals: WeekMeal[] = [];
  for (const row of mealRows) {
    const recipeId = recipeIdBySaved.get(row.saved_recipe_id);
    const recipe = recipeId ? recipeById.get(recipeId) : undefined;
    if (!recipeId || !recipe) continue; // the recipe is no longer readable; never crash the week
    const base: PlannableRecipe = {
      id: recipe.id,
      title: recipe.title,
      servings: recipe.servings,
      total_minutes: recipe.total_minutes,
      ingredients: ingredientsByRecipe.get(recipeId) ?? [],
      steps: stepsByRecipe.get(recipeId) ?? [],
    };
    const changes = changesBySaved.get(row.saved_recipe_id);
    const applied = applyModification(base, changes);
    meals.push({
      id: row.id,
      weekly_plan_id: row.weekly_plan_id,
      saved_recipe_id: row.saved_recipe_id,
      recipe_id: recipeId,
      planned_date: row.planned_date,
      meal_type: row.meal_type as MealType,
      servings: row.servings,
      sort_order: row.sort_order,
      title: applied.title,
      image_url: recipe.image_url,
      total_minutes: applied.total_minutes,
      recipe_servings: applied.servings,
      scalable: isScalable(applied.servings),
      has_version: Boolean(changes),
      recipe: applied,
    });
  }
  return { weekStart, plan, meals };
}

export const toMealInputs = (meals: WeekMeal[]): MealInput[] =>
  meals.map((meal) => ({
    id: meal.id,
    planned_date: meal.planned_date,
    meal_type: meal.meal_type,
    servings: meal.servings,
    sort_order: meal.sort_order,
    recipe: meal.recipe,
  }));

/** The plan row for a week, created on first use. */
export async function getOrCreatePlan(
  db: Supabase,
  weekStart: string,
): Promise<Row<"weekly_plans">> {
  const existing = mustMaybe(
    await db.from("weekly_plans").select("*").eq("week_start_date", weekStart).maybeSingle(),
  );
  if (existing) return existing;
  const created = await db
    .from("weekly_plans")
    .insert({ week_start_date: weekStart })
    .select("*")
    .single();
  if (created.error?.code === "23505") {
    // Two requests raced to create the same week; the other one won.
    return must(
      await db.from("weekly_plans").select("*").eq("week_start_date", weekStart).single(),
    );
  }
  return must(created);
}

/** One planned meal with its week's context (for the cook view). Null when it isn't the person's. */
export async function loadMealById(
  db: Supabase,
  mealId: string,
): Promise<{ ctx: WeekContext; meal: WeekMeal } | null> {
  const row = mustMaybe(
    await db.from("planned_meals").select("id, weekly_plan_id").eq("id", mealId).maybeSingle(),
  );
  if (!row) return null;
  const plan = must(
    await db.from("weekly_plans").select("week_start_date").eq("id", row.weekly_plan_id).single(),
  );
  const ctx = await loadWeekContext(db, plan.week_start_date);
  const meal = ctx.meals.find((m) => m.id === mealId);
  return meal ? { ctx, meal } : null;
}
