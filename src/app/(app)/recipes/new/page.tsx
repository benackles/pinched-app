import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RecipeForm } from "@/components/recipes/recipe-form";
import { EMPTY_DRAFT } from "@/lib/recipes/draft";

export const metadata: Metadata = { title: "Add a recipe" };

export default function NewRecipePage() {
  return (
    <>
      <Link
        href="/recipes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Recipes
      </Link>
      <h1 className="mb-2 text-4xl font-semibold md:text-5xl">Add a recipe</h1>
      <p className="mb-8 max-w-xl text-muted-foreground">
        Type or paste a family favorite or a cookbook recipe. You can attach your own photos
        afterwards.
      </p>
      <div className="max-w-2xl">
        <RecipeForm mode="create" initial={EMPTY_DRAFT} />
      </div>
    </>
  );
}
