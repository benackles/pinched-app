import Link from "next/link";

import { pluralize } from "@/lib/format";
import type { CollectionSummary } from "@/server/queries/recipes";

import { RecipeGrid } from "./recipe-card";
import { RecipeImage } from "./recipe-image";

export function CollectionSummaryGrid({ collections }: { collections: CollectionSummary[] }) {
  return (
    <RecipeGrid>
      {collections.map((c) => (
        <Link
          key={c.id}
          href={`/collections/${c.id}`}
          className="group overflow-hidden rounded-2xl bg-card shadow-card transition-shadow hover:shadow-lift"
        >
          <RecipeImage src={c.coverImage} alt="" title={c.name} className="aspect-[16/9] w-full" />
          <div className="p-4">
            <h3 className="text-xl font-semibold">{c.name}</h3>
            <p className="text-sm text-muted-foreground">{pluralize(c.count, "recipe")}</p>
          </div>
        </Link>
      ))}
    </RecipeGrid>
  );
}
