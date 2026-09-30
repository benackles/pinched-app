"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { saveRecipe } from "@/server/actions/recipes";

/** Round bookmark button for catalog cards. Saving puts the recipe in your book. */
export function SaveIconButton({
  recipeId,
  title,
  saved,
}: {
  recipeId: string;
  title: string;
  saved: boolean;
}) {
  const [isSaved, setSaved] = useState(saved);
  const [pending, start] = useTransition();
  const online = useOnline();

  return (
    <Button
      size="icon"
      variant={isSaved ? "success" : "secondary"}
      aria-label={isSaved ? `${title} is saved` : `Save ${title}`}
      aria-pressed={isSaved}
      disabled={isSaved || pending || !online}
      onClick={() =>
        start(async () => {
          const done = unwrap(await saveRecipe(recipeId), "Saved to My Recipes");
          if (done) setSaved(true);
        })
      }
    >
      {isSaved ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
    </Button>
  );
}
