import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import { TabLinks } from "@/components/common/tab-links";
import { CollectionSummaryGrid } from "@/components/recipes/collection-grid";
import { NewCollectionForm } from "@/components/recipes/collection-forms";
import { ImportDialog } from "@/components/recipes/import-dialog";
import { RecipeCard, RecipeGrid } from "@/components/recipes/recipe-card";
import { MineFilters, RecipeSearch } from "@/components/recipes/recipes-controls";
import { SaveIconButton } from "@/components/recipes/save-button";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CATALOG_TAGS } from "@/lib/catalog/schema";
import { listCollections, listSavedRecipes, searchCatalog } from "@/server/queries/recipes";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Recipes" };

const TABS = ["mine", "discover", "collections"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  mine: "My Recipes",
  discover: "Discover",
  collections: "Collections",
};

const TAG_LABELS: Record<string, string> = {
  "gluten-free": "Gluten-free",
  "dairy-free": "Dairy-free",
  "make-ahead": "Make-ahead",
  "one-pan": "One-pan",
  "high-protein": "High-protein",
};
const tagLabel = (tag: string) => TAG_LABELS[tag] ?? tag[0]!.toUpperCase() + tag.slice(1);

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    tag?: string;
    collection?: string;
    cooked?: string;
  }>;
}) {
  const params = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(params.tab ?? "")
    ? (params.tab as Tab)
    : "mine";
  const q = params.q?.trim().slice(0, 100) ?? "";

  return (
    <>
      <PageHeader eyebrow="Your recipe book" title="Recipes">
        <ImportDialog />
        <Link href="/recipes/new" className={buttonVariants({ variant: "default" })}>
          <Plus aria-hidden /> Add recipe
        </Link>
      </PageHeader>

      {tab !== "collections" && (
        <Suspense>
          <RecipeSearch
            placeholder={
              tab === "mine" ? "Search by title or ingredient" : "Search: chicken, lentils, quick"
            }
          />
        </Suspense>
      )}

      <TabLinks
        label="Recipe sections"
        className="mb-6"
        items={TABS.map((t) => ({
          href: t === "mine" ? "/recipes" : { pathname: "/recipes", query: { tab: t } },
          label: TAB_LABELS[t],
          active: t === tab,
        }))}
      />

      {tab === "mine" && <MyRecipes q={q} collection={params.collection} cooked={params.cooked} />}
      {tab === "discover" && <Discover q={q} tag={params.tag} />}
      {tab === "collections" && <Collections />}
    </>
  );
}

async function MyRecipes({
  q,
  collection,
  cooked,
}: {
  q: string;
  collection?: string;
  cooked?: string;
}) {
  const db = await userClient();
  const [all, collections] = await Promise.all([listSavedRecipes(db), listCollections(db)]);

  if (all.length === 0) {
    return (
      <EmptyState title="Your recipe book is waiting.">
        <p>Save something from the catalog, import a link, or type in a family favorite.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            href={{ pathname: "/recipes", query: { tab: "discover" } }}
            className={buttonVariants({ variant: "default" })}
          >
            Discover recipes
          </Link>
          <Link href="/recipes/new" className={buttonVariants({ variant: "outline" })}>
            Add your own
          </Link>
        </div>
      </EmptyState>
    );
  }

  // Ingredient search needs the ingredient names; fetch only when searching.
  let matchingIds: Set<string> | null = null;
  const term = q.toLowerCase();
  if (term) {
    const { data } = await db
      .from("ingredients")
      .select("recipe_id")
      .ilike("normalized_name", `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      .limit(2000);
    matchingIds = new Set((data ?? []).map((row) => row.recipe_id));
  }

  const list = all.filter((r) => {
    const matches =
      !term ||
      r.title.toLowerCase().includes(term) ||
      (r.author ?? "").toLowerCase().includes(term) ||
      matchingIds?.has(r.id);
    const inCollection = !collection || r.collectionIds.includes(collection);
    const cookedMatch = !cooked || (cooked === "yes" ? r.cookedCount > 0 : r.cookedCount === 0);
    return matches && inCollection && cookedMatch;
  });
  const names = new Map(collections.map((c) => [c.id, c.name]));

  return (
    <>
      <Suspense>
        <MineFilters collections={collections.map((c) => ({ id: c.id, name: c.name }))} />
      </Suspense>
      {list.length ? (
        <RecipeGrid>
          {list.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              footer={
                recipe.collectionIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {recipe.collectionIds.map((id) => (
                      <Badge key={id} variant="accent">
                        {names.get(id)}
                      </Badge>
                    ))}
                  </div>
                ) : null
              }
            />
          ))}
        </RecipeGrid>
      ) : (
        <p className="py-10 text-center text-muted-foreground">No saved recipes match.</p>
      )}
    </>
  );
}

async function Discover({ q, tag }: { q: string; tag?: string }) {
  const db = await userClient();
  const activeTag = tag && (CATALOG_TAGS as readonly string[]).includes(tag) ? tag : undefined;
  const results = await searchCatalog(db, { q, tag: activeTag });

  const chip = (value: string | undefined, label: string) => {
    const query: Record<string, string> = { tab: "discover" };
    if (q) query.q = q;
    if (value) query.tag = value;
    const active = value === activeTag;
    return (
      <Link
        key={label}
        href={{ pathname: "/recipes", query }}
        aria-current={active ? "true" : undefined}
        className={
          "inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold pointer-coarse:h-11 " +
          (active
            ? "border-primary-strong bg-primary-strong text-primary-foreground"
            : "bg-card text-foreground hover:bg-secondary")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter the catalog">
        {chip(undefined, "All")}
        {[
          "breakfast",
          "lunch",
          "dinner",
          "vegetarian",
          "vegan",
          "gluten-free",
          "dairy-free",
          "quick",
          "make-ahead",
        ].map((t) => chip(t, tagLabel(t)))}
      </div>
      {results.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {q ? `No catalog recipes match “${q}”.` : "No recipes here yet."}
        </p>
      ) : (
        <RecipeGrid>
          {results.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              action={
                <SaveIconButton
                  recipeId={recipe.id}
                  title={recipe.title}
                  saved={recipe.savedId !== null}
                />
              }
            />
          ))}
        </RecipeGrid>
      )}
      <p className="mt-8 text-xs text-muted-foreground">
        Diet tags are a guide, not a promise — always check the ingredients if you have an allergy.
      </p>
    </>
  );
}

async function Collections() {
  const db = await userClient();
  const collections = await listCollections(db);
  return (
    <>
      <NewCollectionForm />
      {collections.length === 0 ? (
        <EmptyState>
          Group recipes into collections like “Weeknights” or “Holiday baking”.
        </EmptyState>
      ) : (
        <CollectionSummaryGrid collections={collections} />
      )}
    </>
  );
}
