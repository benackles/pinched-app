import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/common/empty-state";
import { CollectionActions } from "@/components/recipes/collection-forms";
import { RecipeCard, RecipeGrid } from "@/components/recipes/recipe-card";
import { pluralize } from "@/lib/format";
import { uuid } from "@/lib/validation/common";
import { getCollectionDetail } from "@/server/queries/recipes";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Collection" };

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const db = await userClient();
  const detail = await getCollectionDetail(db, id);
  if (!detail) notFound();

  return (
    <>
      <Link
        href={{ pathname: "/recipes", query: { tab: "collections" } }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Recipes
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold md:text-5xl">{detail.collection.name}</h1>
          <p className="mt-1 text-muted-foreground">{pluralize(detail.recipes.length, "recipe")}</p>
        </div>
        <CollectionActions id={detail.collection.id} name={detail.collection.name} />
      </div>
      {detail.recipes.length ? (
        <RecipeGrid>
          {detail.recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </RecipeGrid>
      ) : (
        <EmptyState>No recipes yet. Open a recipe and choose “Add to collection”.</EmptyState>
      )}
    </>
  );
}
