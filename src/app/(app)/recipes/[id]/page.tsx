import { ArrowLeft, Clock, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecipeImage } from "@/components/recipes/recipe-image";
import { RecipeActions, RecipeRating } from "@/components/recipes/recipe-actions";
import {
  RecipeTabs,
  type CookingView,
  type IngredientView,
  type NoteView,
  type VersionView,
} from "@/components/recipes/recipe-tabs";
import type { RecipeChanges } from "@/lib/domain/types";
import { currentWeekStart, dayName, todayInZone } from "@/lib/domain/week";
import { formatMinutes } from "@/lib/format";
import { dayOptions } from "@/lib/plan";
import { formatIngredientLines } from "@/lib/recipes/draft";
import { uuid } from "@/lib/validation/common";
import { requireSession } from "@/server/auth";
import { getProfile, getTimezone } from "@/server/profile";
import { getRecipeDetail } from "@/server/queries/recipes";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Recipe" };

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const session = await requireSession();
  const db = await userClient();
  const tz = await getTimezone(await getProfile());
  const today = todayInZone(tz);
  const detail = await getRecipeDetail(db, id, session.userId, today);
  if (!detail) notFound();

  const { recipe, saved, modification } = detail;
  const changes = (modification?.changes ?? null) as RecipeChanges | null;

  const ingredients: IngredientView[] = detail.ingredients.map((row) => ({
    quantity: row.quantity,
    quantity_max: row.quantity_max,
    unit: row.unit,
    name: row.name,
    preparation: row.preparation,
    raw_text: row.raw_text,
    group_label: row.group_label,
  }));
  const steps = detail.steps.map((step) => step.instruction);

  const original: VersionView = {
    title: recipe.title,
    servings: recipe.servings,
    total_minutes: recipe.total_minutes,
    ingredients: formatIngredientLines(detail.ingredients),
    steps: steps.join("\n"),
  };
  const version: VersionView | null = changes
    ? {
        title: changes.title ?? original.title,
        servings: changes.servings !== undefined ? changes.servings : original.servings,
        total_minutes:
          changes.total_minutes !== undefined ? changes.total_minutes : original.total_minutes,
        ingredients: changes.ingredients
          ? changes.ingredients.map((i) => i.raw_text).join("\n")
          : original.ingredients,
        steps: changes.steps ? changes.steps.join("\n") : original.steps,
      }
    : null;

  const notes: NoteView[] = detail.notes.map((n) => ({
    id: n.id,
    text: n.text,
    created_at: n.created_at,
  }));
  const cooking: CookingView[] = detail.cooking.map((c) => ({
    id: c.id,
    cooked_at: c.cooked_at,
    rating: c.rating,
    note: c.note,
  }));

  const thisWeek = currentWeekStart(tz);
  const host = hostOf(recipe.source_url);
  const eyebrow =
    recipe.source === "url_import"
      ? `Imported from ${host ?? "the web"}`
      : (recipe.author ?? (recipe.source === "seeded" ? "Pinched Kitchen" : "Your recipe"));

  return (
    <>
      <Link
        href="/recipes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Recipes
      </Link>

      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr]">
        <RecipeImage
          src={recipe.image_url}
          alt={recipe.title}
          title={recipe.title}
          priority
          className="aspect-[4/3] w-full rounded-3xl shadow-lift"
        />
        <div className="flex flex-col justify-center">
          <p className="text-sm font-semibold tracking-wider text-primary-strong uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-4xl leading-tight font-semibold md:text-5xl">{recipe.title}</h1>
          {recipe.source === "url_import" && (recipe.author || recipe.source_url) && (
            <p className="mt-2 text-sm text-muted-foreground">
              {recipe.author && <>Recipe by {recipe.author}. </>}
              {recipe.source_url && (
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  View the original
                </a>
              )}
            </p>
          )}
          {recipe.headnote && <p className="mt-3 text-muted-foreground">{recipe.headnote}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            {recipe.total_minutes != null && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden /> {formatMinutes(recipe.total_minutes)}
              </span>
            )}
            {recipe.servings != null && (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4" aria-hidden /> Serves {recipe.servings}
              </span>
            )}
            <RecipeRating recipeId={recipe.id} rating={saved?.personal_rating ?? null} />
          </div>

          <RecipeActions
            recipe={{
              id: recipe.id,
              title: recipe.title,
              imageUrl: recipe.image_url,
              servings: recipe.servings,
              totalMinutes: recipe.total_minutes,
              tags: recipe.tags,
              inBook: saved !== null,
            }}
            saved={saved !== null}
            isOwner={detail.isOwner}
            collections={detail.collections.map((c) => ({ id: c.id, name: c.name }))}
            memberOf={detail.memberOf}
            days={dayOptions(thisWeek, 2)}
            defaultDate={today}
            today={today}
          />

          {detail.planned.length > 0 && (
            <div className="mt-5 rounded-2xl bg-accent p-4 text-sm text-accent-foreground">
              <p className="font-semibold">
                On your plan:{" "}
                {detail.planned.map((m) => `${dayName(m.planned_date)} ${m.meal_type}`).join(", ")}
              </p>
              <p className="mt-0.5">
                <Link href="/plan" className="underline">
                  Open the plan
                </Link>
                {" · "}
                <Link href="/prep" className="underline">
                  Open prep
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>

      <RecipeTabs
        recipeId={recipe.id}
        baseServings={recipe.servings}
        servingsLabel={recipe.servings_label}
        ingredients={ingredients}
        steps={steps}
        original={original}
        version={version}
        notes={notes}
        cooking={cooking}
      />
    </>
  );
}
