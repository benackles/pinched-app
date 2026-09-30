"use client";

import { Check, ChefHat, Clock, Minus, MoreHorizontal, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { RecipeImage } from "@/components/recipes/recipe-image";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { formatMinutes } from "@/lib/format";
import { removeMeal, updateMeal } from "@/server/actions/plan";

export type MealCardData = {
  id: string;
  recipeId: string;
  title: string;
  imageUrl: string | null;
  mealType: string;
  totalMinutes: number | null;
  servings: number;
  scalable: boolean;
  hasVersion: boolean;
  date: string;
  prep: { state: "none" | "partial" | "done"; label: string };
};

export type MoveTarget = { value: string; label: string };

const stepper =
  "hit-44 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";

/** Thumbnail, meal type, title, time, servings stepper, prep status chip and an overflow menu. */
export function MealCard({ meal, moveTargets }: { meal: MealCardData; moveTargets: MoveTarget[] }) {
  const [servings, setServings] = useState(meal.servings);
  const [pending, start] = useTransition();
  const online = useOnline();

  function changeServings(next: number) {
    if (next < 1 || next > 99) return;
    const previous = servings;
    setServings(next);
    start(async () => {
      const done = unwrap(await updateMeal({ mealId: meal.id, servings: next }));
      if (!done) setServings(previous);
    });
  }

  function move(date: string, label: string) {
    start(async () => {
      const done = unwrap(await updateMeal({ mealId: meal.id, date }), `Moved to ${label}`);
      void done;
    });
  }

  function remove() {
    start(async () => {
      const done = unwrap(await removeMeal(meal.id));
      if (done) toast.success(`Removed ${meal.title}`);
    });
  }

  return (
    <div className="flex gap-3 rounded-2xl bg-card p-3 shadow-card">
      <Link href={`/recipes/${meal.recipeId}`} className="shrink-0" tabIndex={-1} aria-hidden>
        <RecipeImage src={meal.imageUrl} alt="" title={meal.title} className="size-24 rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wider text-primary-strong uppercase">
              {meal.mealType}
            </p>
            <Link
              href={`/recipes/${meal.recipeId}`}
              className="line-clamp-2 leading-snug font-semibold hover:underline"
            >
              {meal.title}
            </Link>
            {meal.hasVersion && <span className="text-xs text-muted-foreground">Your version</span>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="hit-44 rounded-full p-1 text-muted-foreground hover:bg-muted"
              aria-label={`Options for ${meal.title}`}
              disabled={pending}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/cook/${meal.id}`}>
                  <ChefHat className="size-4" aria-hidden /> Cook this
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {moveTargets
                .filter((d) => d.value !== meal.date)
                .map((d) => (
                  <DropdownMenuItem
                    key={d.value}
                    disabled={!online}
                    onSelect={() => move(d.value, d.label)}
                  >
                    {d.label}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" disabled={!online} onSelect={remove}>
                Remove from week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {meal.totalMinutes != null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden /> {formatMinutes(meal.totalMinutes)}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" aria-hidden />
            {meal.scalable ? (
              <>
                <button
                  type="button"
                  className={stepper}
                  aria-label={`Fewer servings of ${meal.title}`}
                  disabled={!online || servings <= 1}
                  onClick={() => changeServings(servings - 1)}
                >
                  <Minus className="size-3" aria-hidden />
                </button>
                <span
                  aria-live="polite"
                  className="min-w-4 text-center font-medium text-foreground"
                >
                  {servings}
                </span>
                <button
                  type="button"
                  className={stepper}
                  aria-label={`More servings of ${meal.title}`}
                  disabled={!online || servings >= 99}
                  onClick={() => changeServings(servings + 1)}
                >
                  <Plus className="size-3" aria-hidden />
                </button>
              </>
            ) : (
              <span title="This recipe doesn't say how many it makes, so quantities are used as written.">
                {servings} {servings === 1 ? "serving" : "servings"}
              </span>
            )}
          </span>
          {meal.prep.state === "done" ? (
            <Badge variant="success">
              <Check aria-hidden /> Prepped
            </Badge>
          ) : (
            <Badge variant="muted">{meal.prep.label}</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
