import { Clock } from "lucide-react";
import Link from "next/link";

import { formatMinutes } from "@/lib/format";
import type { RecipeCardData } from "@/lib/recipes/types";

import { RecipeImage } from "./recipe-image";
import { StarRating } from "./star-rating";

/** Photo, title, time, rating. `action` floats in the top-right corner (save, remove…). */
export function RecipeCard({
  recipe,
  action,
  footer,
}: {
  recipe: RecipeCardData;
  action?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-card shadow-card transition-shadow hover:shadow-lift">
      <Link href={`/recipes/${recipe.id}`} className="block">
        <RecipeImage
          src={recipe.imageUrl}
          alt=""
          title={recipe.title}
          className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
        />
        <div className="p-4">
          <h3 className="text-lg font-semibold leading-snug">{recipe.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {recipe.author && recipe.source !== "seeded" && <span>{recipe.author}</span>}
            {recipe.totalMinutes != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden /> {formatMinutes(recipe.totalMinutes)}
              </span>
            )}
          </div>
          {recipe.rating != null && (
            <div className="mt-2">
              <StarRating value={recipe.rating} />
            </div>
          )}
          {footer}
        </div>
      </Link>
      {action && <div className="absolute right-3 top-3">{action}</div>}
    </div>
  );
}

export function RecipeGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
