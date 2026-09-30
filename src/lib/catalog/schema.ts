import { z } from "zod";

/** Tags the catalog may use. Diet tags are a guide, not a promise — people must check ingredients for allergies. */
export const CATALOG_TAGS = [
  "breakfast",
  "lunch",
  "dinner",
  "vegetarian",
  "vegan",
  "gluten-free",
  "dairy-free",
  "pescatarian",
  "quick",
  "make-ahead",
  "one-pan",
  "high-protein",
] as const;
export type CatalogTag = (typeof CATALOG_TAGS)[number];

/** Diet filters offered in the catalog browser. */
export const DIET_TAGS = ["vegetarian", "vegan", "gluten-free", "dairy-free"] as const;

export const catalogRecipeSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase-kebab"),
    title: z.string().min(3).max(120),
    /** Original expressive text written for Pinched — no claims about origin or authorship. */
    headnote: z.string().min(20).max(400),
    servings: z.number().int().min(1).max(24),
    prep_minutes: z.number().int().min(0).max(600),
    cook_minutes: z.number().int().min(0).max(1440),
    tags: z.array(z.enum(CATALOG_TAGS)).min(1),
    ingredients: z.array(z.string().min(2)).min(3),
    steps: z.array(z.string().min(8)).min(2),
    /** A human has checked the headnote, ingredients and diet tags. Only reviewed recipes are published. */
    reviewed: z.boolean().default(false),
  })
  .strict();

export type CatalogRecipe = z.infer<typeof catalogRecipeSchema>;
