"use client";

import { ArrowLeft, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { RecipeImage } from "@/components/recipes/recipe-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/form-controls";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { MEAL_TYPES, type MealType } from "@/lib/domain/constants";
import { addMeal } from "@/server/actions/plan";

export type MealPick = {
  id: string;
  title: string;
  imageUrl: string | null;
  servings: number | null;
  totalMinutes: number | null;
  tags: string[];
  inBook: boolean;
};

export type DayOption = { value: string; label: string };

const defaultMealType = (tags: string[]): MealType =>
  tags.includes("breakfast") ? "breakfast" : tags.includes("lunch") ? "lunch" : "dinner";

/** "Add a meal": pick a recipe (unless one is given), a day, a meal type and servings. */
export function AddMealDialog({
  open,
  onOpenChange,
  days,
  defaultDate,
  recipes,
  recipe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  days: DayOption[];
  defaultDate: string;
  /** Recipes to choose from. Omit when `recipe` is preselected. */
  recipes?: MealPick[];
  recipe?: MealPick;
}) {
  const [picked, setPicked] = useState<MealPick | null>(recipe ?? null);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [mealType, setMealType] = useState<MealType>(
    recipe ? defaultMealType(recipe.tags) : "dinner",
  );
  const [servings, setServings] = useState(recipe?.servings ?? 4);
  const [pending, start] = useTransition();
  const online = useOnline();

  // Re-seed the form each time the dialog opens (the parent keeps this component mounted).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicked(recipe ?? null);
      setQuery("");
      setDate(defaultDate);
      setMealType(recipe ? defaultMealType(recipe.tags) : "dinner");
      setServings(recipe?.servings ?? 4);
    }
  }

  const choose = (pick: MealPick) => {
    setPicked(pick);
    setMealType(defaultMealType(pick.tags));
    setServings(pick.servings ?? 4);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (recipes ?? []).filter((r) => !q || r.title.toLowerCase().includes(q));
  }, [recipes, query]);
  const inBook = filtered.filter((r) => r.inBook);
  const more = filtered.filter((r) => !r.inBook);

  function submit() {
    if (!picked) return;
    start(async () => {
      const done = unwrap(await addMeal({ recipeId: picked.id, date, mealType, servings }));
      if (!done) return;
      const day = days.find((d) => d.value === date)?.label ?? "your week";
      toast.success(`${picked.title} added to ${day}`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {picked ? "Add to your week" : "Add a meal"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a recipe, a day, a meal type and how many servings.
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="space-y-4">
            <div className="relative">
              <Search
                className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="h-12 rounded-full pl-11"
                placeholder="Search your recipes…"
                aria-label="Search recipes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <PickList title="Your recipe book" items={inBook} onPick={choose} />
            <PickList title="From the catalog" items={more} onPick={choose} />
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No recipes match.</p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
              <RecipeImage
                src={picked.imageUrl}
                alt=""
                title={picked.title}
                className="size-14 shrink-0 rounded-lg"
              />
              <p className="flex-1 font-semibold">{picked.title}</p>
              {!recipe && (
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                  <ArrowLeft /> Change
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="meal-day">Day</Label>
                <NativeSelect id="meal-day" value={date} onChange={(e) => setDate(e.target.value)}>
                  {days.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="meal-type">Meal</Label>
                <NativeSelect
                  id="meal-type"
                  value={mealType}
                  onChange={(e) => setMealType(e.target.value as MealType)}
                >
                  {MEAL_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {m[0]!.toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="meal-servings">Servings</Label>
              <Input
                id="meal-servings"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={servings}
                onChange={(e) =>
                  setServings(Math.min(99, Math.max(1, Number(e.target.value) || 1)))
                }
              />
              {picked.servings && picked.servings !== servings && (
                <p className="text-xs text-muted-foreground">
                  The recipe makes {picked.servings}; quantities are scaled to {servings}.
                </p>
              )}
            </div>
          </div>
        )}

        {picked && (
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !online}>
              {online ? "Add to week" : "Offline"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickList({
  title,
  items,
  onPick,
}: {
  title: string;
  items: MealPick[];
  onPick: (pick: MealPick) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((pick) => (
          <li key={pick.id}>
            <button
              type="button"
              onClick={() => onPick(pick)}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted"
            >
              <RecipeImage
                src={pick.imageUrl}
                alt=""
                title={pick.title}
                className="size-12 shrink-0 rounded-lg"
              />
              <span className="font-medium">{pick.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
