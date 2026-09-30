import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecipeForm } from "@/components/recipes/recipe-form";
import { formatIngredientLines, type RecipeDraft } from "@/lib/recipes/draft";
import { uuid } from "@/lib/validation/common";
import { requireSession } from "@/server/auth";
import { getRecipeDetail } from "@/server/queries/recipes";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Edit recipe" };

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const session = await requireSession();
  const db = await userClient();
  const detail = await getRecipeDetail(db, id, session.userId, "0000-01-01");
  // Catalog recipes can't be edited — make a personal version instead.
  if (!detail || !detail.isOwner) notFound();

  const { recipe } = detail;
  const draft: RecipeDraft = {
    title: recipe.title,
    author: recipe.author ?? "",
    source_url: recipe.source_url ?? "",
    image_url: recipe.image_url ?? "",
    servings: recipe.servings === null ? "" : String(recipe.servings),
    servings_label: recipe.servings_label ?? "",
    prep_minutes: recipe.prep_minutes === null ? "" : String(recipe.prep_minutes),
    cook_minutes: recipe.cook_minutes === null ? "" : String(recipe.cook_minutes),
    ingredients: formatIngredientLines(detail.ingredients),
    steps: detail.steps.map((s) => s.instruction).join("\n"),
  };

  return (
    <>
      <Link
        href={`/recipes/${recipe.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> {recipe.title}
      </Link>
      <h1 className="mb-8 text-4xl font-semibold md:text-5xl">Edit recipe</h1>
      <div className="max-w-2xl">
        <RecipeForm mode="edit" initial={draft} recipeId={recipe.id} />
      </div>
    </>
  );
}
