"use client";

import {
  BookmarkCheck,
  CalendarPlus,
  Check,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AddMealDialog, type DayOption, type MealPick } from "@/components/plan/add-meal-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { cn } from "@/lib/utils";
import { setCollectionMembership } from "@/server/actions/recipe-extras";
import { deleteOwnRecipe, rateRecipe, saveRecipe, unsaveRecipe } from "@/server/actions/recipes";

import { CookedDialog } from "./cooked-dialog";
import { StarRating } from "./star-rating";

export function RecipeRating({ recipeId, rating }: { recipeId: string; rating: number | null }) {
  const [value, setValue] = useState(rating);
  const [pending, start] = useTransition();
  const online = useOnline();
  return (
    <StarRating
      value={value}
      disabled={pending || !online}
      onChange={(next) => {
        const previous = value;
        setValue(next || null);
        start(async () => {
          const done = unwrap(await rateRecipe({ recipeId, rating: next || null }));
          if (!done) setValue(previous);
        });
      }}
    />
  );
}

type Props = {
  recipe: MealPick;
  saved: boolean;
  isOwner: boolean;
  collections: { id: string; name: string }[];
  memberOf: string[];
  days: DayOption[];
  defaultDate: string;
  today: string;
};

export function RecipeActions({
  recipe,
  saved,
  isOwner,
  collections,
  memberOf,
  days,
  defaultDate,
  today,
}: Props) {
  const router = useRouter();
  const online = useOnline();
  const [addOpen, setAddOpen] = useState(false);
  const [cookedOpen, setCookedOpen] = useState(false);
  const [confirm, setConfirm] = useState<"remove" | "delete" | null>(null);
  const [member, setMember] = useState(new Set(memberOf));
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      unwrap(await saveRecipe(recipe.id), "Saved to My Recipes");
    });

  const toggleCollection = (collectionId: string) => {
    const next = !member.has(collectionId);
    setMember((set) => {
      const copy = new Set(set);
      if (next) copy.add(collectionId);
      else copy.delete(collectionId);
      return copy;
    });
    start(async () => {
      const done = unwrap(
        await setCollectionMembership({ recipeId: recipe.id, collectionId, member: next }),
      );
      if (!done) {
        setMember((set) => {
          const copy = new Set(set);
          if (next) copy.delete(collectionId);
          else copy.add(collectionId);
          return copy;
        });
      }
    });
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button disabled={!online} onClick={() => setAddOpen(true)}>
          <CalendarPlus aria-hidden /> Add to week
        </Button>
        {saved ? (
          <Button variant="success" disabled aria-label="Saved to My Recipes">
            <BookmarkCheck aria-hidden /> Saved
          </Button>
        ) : (
          <Button variant="outline" disabled={pending || !online} onClick={save}>
            Save
          </Button>
        )}
        <Button variant="outline" disabled={!online} onClick={() => setCookedOpen(true)}>
          <Check aria-hidden /> Mark as cooked
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={!online}>
              <FolderPlus aria-hidden /> Collection
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Collections</DropdownMenuLabel>
            {collections.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={member.has(c.id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleCollection(c.id)}
              >
                {c.name}
              </DropdownMenuCheckboxItem>
            ))}
            {collections.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                Create a collection on the Recipes page first.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {(isOwner || saved) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: "outline", size: "icon" }))}
              aria-label="More recipe actions"
              disabled={!online}
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOwner && (
                <DropdownMenuItem asChild>
                  <Link href={`/recipes/${recipe.id}/edit`}>
                    <Pencil className="size-4" aria-hidden /> Edit recipe
                  </Link>
                </DropdownMenuItem>
              )}
              {saved && !isOwner && (
                <DropdownMenuItem onSelect={() => setConfirm("remove")}>
                  <Trash2 className="size-4" aria-hidden /> Remove from my recipes
                </DropdownMenuItem>
              )}
              {isOwner && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => setConfirm("delete")}
                  >
                    <Trash2 className="size-4" aria-hidden /> Delete recipe
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <AddMealDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        days={days}
        defaultDate={defaultDate}
        recipe={recipe}
      />
      <CookedDialog
        recipeId={recipe.id}
        today={today}
        open={cookedOpen}
        onOpenChange={setCookedOpen}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? "Delete this recipe?" : "Remove from your recipes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "This permanently deletes the recipe and takes it out of any planned weeks, grocery lists and prep plans."
                : "It will also come off any week you've planned it in, along with the grocery items and prep tasks made from it. Your notes, version and photos go too."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                start(async () => {
                  const done =
                    confirm === "delete"
                      ? unwrap(await deleteOwnRecipe(recipe.id), "Recipe deleted")
                      : unwrap(await unsaveRecipe(recipe.id), "Removed from My Recipes");
                  if (done) router.push("/recipes");
                })
              }
            >
              {confirm === "delete" ? "Delete recipe" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
