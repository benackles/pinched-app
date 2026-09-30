import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import {
  AddCustomForm,
  GroceryList,
  RegenerateGroceryButton,
  UpdateBanner,
} from "@/components/grocery/grocery-client";
import { buttonVariants } from "@/components/ui/button";
import type { GrocerySection } from "@/lib/domain/constants";
import { currentWeekStart, isISODate, mondayOf, shiftWeek, shortDate } from "@/lib/domain/week";
import type { GroceryItemView } from "@/lib/grocery-view";
import { pluralize } from "@/lib/format";
import { withWeek } from "@/lib/routes";
import { requireSession } from "@/server/auth";
import { planGrocery, summarizeGroceryChanges } from "@/server/generate/grocery";
import { getTimezone } from "@/server/profile";
import { loadWeekContext } from "@/server/queries/week";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Grocery List" };

export default async function GroceryPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const session = await requireSession();
  const db = await userClient();
  const tz = await getTimezone();
  const thisWeek = currentWeekStart(tz);
  const weekStart = week && isISODate(week) ? mondayOf(week) : thisWeek;

  const ctx = await loadWeekContext(db, weekStart);
  const { list, existing, sources, merged } = await planGrocery(db, ctx);

  const titleByMeal = new Map(ctx.meals.map((m) => [m.id, m.title]));
  const sourcesByItem = new Map<string, string[]>();
  for (const row of sources) {
    const title = titleByMeal.get(row.planned_meal_id);
    if (!title) continue;
    const titles = sourcesByItem.get(row.grocery_list_item_id) ?? [];
    if (!titles.includes(title)) titles.push(title);
    sourcesByItem.set(row.grocery_list_item_id, titles);
  }

  const visible = existing.filter((row) => !row.is_removed);
  const items: GroceryItemView[] = visible.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    display_text: row.display_text,
    section: row.section as GrocerySection,
    is_checked: row.is_checked,
    is_already_owned: row.is_already_owned,
    is_custom: row.is_custom,
    sources: sourcesByItem.get(row.id) ?? [],
  }));
  const removed = existing
    .filter((row) => row.is_removed)
    .map((row) => ({ id: row.id, name: row.name }));
  const remaining = items.filter((i) => !i.is_already_owned && !i.is_checked).length;
  const changes = list ? summarizeGroceryChanges(existing, merged) : null;
  const stale = changes && changes.added + changes.removed + changes.changed > 0;

  const prev = withWeek("/grocery-list", shiftWeek(weekStart, -1), thisWeek);
  const next = withWeek("/grocery-list", shiftWeek(weekStart, 1), thisWeek);

  return (
    <>
      <PageHeader
        eyebrow={`Week of ${shortDate(weekStart)}${list ? ` · ${remaining} to buy` : ""}`}
        title="Grocery List"
      >
        <Link
          href={prev}
          aria-label="Previous week"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ChevronLeft aria-hidden />
        </Link>
        <Link
          href={next}
          aria-label="Next week"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ChevronRight aria-hidden />
        </Link>
        {list && <RegenerateGroceryButton weekStart={weekStart} label="Regenerate" />}
      </PageHeader>

      {!list && ctx.meals.length === 0 && (
        <EmptyState title="Nothing to shop for yet.">
          <p>
            Plan a few meals and your list builds itself — only what you&apos;re missing, sorted by
            aisle.
          </p>
          <Link href="/plan" className={buttonVariants({ className: "mt-4" })}>
            Go to your plan
          </Link>
        </EmptyState>
      )}

      {!list && ctx.meals.length > 0 && (
        <EmptyState title={`Ready to shop for ${pluralize(ctx.meals.length, "meal")}?`}>
          <p>
            We&apos;ll combine the ingredients, leave out what&apos;s already in your kitchen and
            sort the rest by aisle.
          </p>
          <div className="mt-4 flex justify-center">
            <RegenerateGroceryButton
              weekStart={weekStart}
              label="Generate grocery list"
              variant="default"
            />
          </div>
        </EmptyState>
      )}

      {list && (
        <>
          {stale && changes && (
            <UpdateBanner
              weekStart={weekStart}
              added={changes.added}
              removed={changes.removed}
              changed={changes.changed}
            />
          )}
          <AddCustomForm weekStart={weekStart} />
          {items.length === 0 ? (
            <EmptyState>
              Your list is empty. Add an item above, or add meals to your plan.
            </EmptyState>
          ) : (
            <GroceryList
              userId={session.userId}
              weekStart={weekStart}
              items={items}
              removed={removed}
            />
          )}
        </>
      )}
    </>
  );
}
