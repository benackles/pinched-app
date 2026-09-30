"use client";

import { Check, ChefHat } from "lucide-react";
import { useState, useTransition } from "react";

import { CookedDialog } from "@/components/recipes/cooked-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import type { Deduction } from "@/lib/domain/deductions";
import { formatQuantity, unitLabel } from "@/lib/domain/units";
import { cn } from "@/lib/utils";
import { applyKitchenDeductions } from "@/server/actions/kitchen";

export type CookIngredient = { key: string; text: string; group: string | null };

/** Tick ingredients and steps as you go. Local to this screen — nothing is saved until you mark it cooked. */
export function CookChecklists({
  ingredients,
  steps,
}: {
  ingredients: CookIngredient[];
  steps: string[];
}) {
  const [gathered, setGathered] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());
  const flip = <T,>(set: Set<T>, value: T) => {
    const copy = new Set(set);
    if (copy.has(value)) copy.delete(value);
    else copy.add(value);
    return copy;
  };

  const items = ingredients.map((ingredient, index) => ({
    ingredient,
    header:
      ingredient.group && ingredient.group !== ingredients[index - 1]?.group
        ? ingredient.group
        : null,
  }));
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.6fr]">
      <section aria-labelledby="cook-ingredients">
        <h2 id="cook-ingredients" className="mb-4 text-2xl font-semibold">
          Ingredients
        </h2>
        <ul className="space-y-2">
          {items.map(({ ingredient, header }) => {
            const checked = gathered.has(ingredient.key);
            return (
              <li key={ingredient.key}>
                {header && (
                  <p className="mt-3 mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    {header}
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-3 py-1">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => setGathered((s) => flip(s, ingredient.key))}
                    className="mt-0.5 size-5"
                  />
                  <span className={cn(checked && "text-muted-foreground line-through")}>
                    {ingredient.text}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="cook-steps">
        <h2 id="cook-steps" className="mb-4 text-2xl font-semibold">
          Instructions
        </h2>
        <ol className="space-y-5">
          {steps.map((step, index) => {
            const checked = done.has(index);
            return (
              <li key={index} className="flex gap-4">
                <span
                  className="font-display text-3xl leading-none font-semibold text-primary-strong"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <label className="flex flex-1 cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => setDone((s) => flip(s, index))}
                    className="mt-1 size-5"
                    aria-label={`Step ${index + 1} done`}
                  />
                  <span
                    className={cn(
                      "text-lg leading-relaxed",
                      checked && "text-muted-foreground line-through",
                    )}
                  >
                    {step}
                  </span>
                </label>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

export function PrepDoneCard({ tasks }: { tasks: { id: string; title: string; done: boolean }[] }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-5 shadow-card">
        <h2 className="text-lg font-semibold">Prep</h2>
        <p className="text-sm text-muted-foreground">No prep-ahead tasks for this meal.</p>
      </div>
    );
  }
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="rounded-2xl bg-card p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Prep already done</h2>
        <Badge variant={done === tasks.length ? "success" : "muted"}>
          {done} of {tasks.length}
        </Badge>
      </div>
      <ul className="mt-2 space-y-1.5 text-sm">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            {task.done ? (
              <Check className="size-4 text-success-strong" aria-hidden />
            ) : (
              <span
                className="size-4 rounded-full border-2 border-muted-foreground/50"
                aria-hidden
              />
            )}
            <span className={cn(task.done && "text-muted-foreground")}>
              {task.title}
              <span className="sr-only">{task.done ? " — done" : " — not done yet"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mark cooked → rating and note → optionally update the kitchen with suggested deductions. */
export function CookFinish({
  recipeId,
  plannedMealId,
  today,
  cookedOn,
  suggestions,
}: {
  recipeId: string;
  plannedMealId: string;
  today: string;
  cookedOn: string[];
  suggestions: Deduction[];
}) {
  const [cookedOpen, setCookedOpen] = useState(false);
  const [kitchenOpen, setKitchenOpen] = useState(false);
  const online = useOnline();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={!online} onClick={() => setCookedOpen(true)}>
          <ChefHat aria-hidden /> Mark as cooked
        </Button>
        {cookedOn.length > 0 && (
          <p className="text-sm text-muted-foreground">
            <Check className="mr-1 inline size-4 text-success-strong" aria-hidden />
            Cooked {cookedOn.join(", ")}
          </p>
        )}
      </div>
      <CookedDialog
        recipeId={recipeId}
        plannedMealId={plannedMealId}
        today={today}
        open={cookedOpen}
        onOpenChange={setCookedOpen}
        onLogged={() => suggestions.length > 0 && setKitchenOpen(true)}
      />
      {kitchenOpen && (
        <UpdateKitchenDialog suggestions={suggestions} onClose={() => setKitchenOpen(false)} />
      )}
    </>
  );
}

function amount(value: number, unit: string | null) {
  return `${formatQuantity(value) || "0"}${unit ? ` ${unitLabel(unit, value)}` : ""}`;
}

function UpdateKitchenDialog({
  suggestions,
  onClose,
}: {
  suggestions: Deduction[];
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(new Set(suggestions.map((s) => s.kitchen_item_id)));
  const [pending, start] = useTransition();

  function apply() {
    const items = suggestions
      .filter((s) => chosen.has(s.kitchen_item_id))
      .map((s) => ({ id: s.kitchen_item_id, quantity: s.remaining }));
    if (items.length === 0) {
      onClose();
      return;
    }
    start(async () => {
      const done = unwrap(await applyKitchenDeductions({ items }), "Kitchen updated");
      if (done) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Update your kitchen?</DialogTitle>
          <DialogDescription>
            Here&apos;s what this meal likely used. Pinched never changes your kitchen on its own —
            tick what you&apos;d like updated.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {suggestions.map((s) => {
            const id = `ded-${s.kitchen_item_id}`;
            return (
              <li key={s.kitchen_item_id} className="flex items-start gap-3">
                <Checkbox
                  id={id}
                  checked={chosen.has(s.kitchen_item_id)}
                  onCheckedChange={() =>
                    setChosen((set) => {
                      const copy = new Set(set);
                      if (copy.has(s.kitchen_item_id)) copy.delete(s.kitchen_item_id);
                      else copy.add(s.kitchen_item_id);
                      return copy;
                    })
                  }
                  className="mt-0.5"
                />
                <label htmlFor={id} className="flex-1 cursor-pointer">
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {amount(s.have, s.unit)} →{" "}
                    {s.remaining === 0 ? "none left" : amount(s.remaining, s.unit)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <Button onClick={apply} disabled={pending}>
            Update kitchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
