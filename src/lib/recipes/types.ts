import type { ImportedRecipe } from "@/lib/recipe-import/schema";

export type { ImportedRecipe };

export type RecipeSource = "seeded" | "url_import" | "manual";

/** Everything a recipe card needs, for catalog results and the person's own book alike. */
export type RecipeCardData = {
  id: string;
  source: RecipeSource;
  title: string;
  author: string | null;
  imageUrl: string | null;
  totalMinutes: number | null;
  servings: number | null;
  tags: string[];
  /** Set when the recipe is in the person's book. */
  savedId: string | null;
  rating: number | null;
  favorite: boolean;
  cookedCount: number;
  collectionIds: string[];
};

export type RecipeSearchResult = Pick<
  RecipeCardData,
  "id" | "source" | "title" | "author" | "imageUrl" | "totalMinutes" | "servings" | "tags"
>;

export type CatalogFilters = {
  q?: string;
  /** One of the catalog tags (breakfast, vegetarian, quick…). */
  tag?: string;
};

/**
 * Recipe sources stay swappable behind one interface (PRD → Stack and architecture):
 *  - SeededCatalogProvider — queries the recipes table
 *  - UrlImportProvider — fetches one URL and parses its schema.org Recipe JSON-LD
 *  - LicensedApiProvider — later (Spoonacular / Edamam)
 */
export interface RecipeProvider {
  readonly id: "seeded" | "url_import" | "licensed";
  search(query: string, filters?: CatalogFilters): Promise<RecipeSearchResult[]>;
  getRecipe(id: string): Promise<ImportedRecipe>;
}
