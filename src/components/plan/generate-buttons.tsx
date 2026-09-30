"use client";

import { ChefHat, ShoppingBasket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { offerInstall } from "@/components/pwa/install-prompt";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { pluralize } from "@/lib/format";
import type { Route } from "next";
import { regenerateGrocery, regeneratePrep } from "@/server/actions/generate";

/** "Generate Grocery List" and "Create Prep Plan" — each builds the output, then opens it. */
export function GenerateButtons({
  weekStart,
  hasMeals,
  groceryHref,
  prepHref,
  groceryExists,
  prepExists,
}: {
  weekStart: string;
  hasMeals: boolean;
  groceryHref: Route;
  prepHref: Route;
  groceryExists: boolean;
  prepExists: boolean;
}) {
  const router = useRouter();
  const online = useOnline();
  const [pending, start] = useTransition();

  const grocery = () =>
    start(async () => {
      const done = unwrap(await regenerateGrocery({ weekStart }));
      if (!done) return;
      toast.success(`Grocery list ready — ${pluralize(done.data.toBuy, "item")} to buy`);
      if (done.data.created) offerInstall();
      router.push(groceryHref);
    });
  const prep = () =>
    start(async () => {
      const done = unwrap(await regeneratePrep({ weekStart }));
      if (!done) return;
      toast.success(
        `Prep plan ready — ${pluralize(done.data.tasks, "task")}, ${done.data.totalMinutes} min`,
      );
      if (done.data.created) offerInstall();
      router.push(prepHref);
    });

  const disabled = !hasMeals || pending || !online;
  return (
    <div className="mb-8 flex flex-wrap gap-2">
      <Button variant="secondary" disabled={disabled} onClick={grocery}>
        <ShoppingBasket aria-hidden />{" "}
        {groceryExists ? "Update grocery list" : "Generate Grocery List"}
      </Button>
      <Button variant="secondary" disabled={disabled} onClick={prep}>
        <ChefHat aria-hidden /> {prepExists ? "Update prep plan" : "Create Prep Plan"}
      </Button>
      {!hasMeals && <p className="self-center text-sm text-muted-foreground">Add a meal first.</p>}
    </div>
  );
}
