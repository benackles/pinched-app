import type { RecipeFormInput } from "@/lib/validation/recipes";

/** A recipe as the form edits it: every field is text, ingredients and steps one per line. */
export type RecipeDraft = {
  title: string;
  author: string;
  source_url: string;
  image_url: string;
  servings: string;
  servings_label: string;
  prep_minutes: string;
  cook_minutes: string;
  ingredients: string;
  steps: string;
};

export const EMPTY_DRAFT: RecipeDraft = {
  title: "",
  author: "",
  source_url: "",
  image_url: "",
  servings: "",
  servings_label: "",
  prep_minutes: "",
  cook_minutes: "",
  ingredients: "",
  steps: "",
};

const toNumber = (value: string): number | null => {
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export function draftToInput(draft: RecipeDraft): RecipeFormInput {
  return {
    title: draft.title,
    author: draft.author,
    source_url: draft.source_url,
    image_url: draft.image_url,
    servings: toNumber(draft.servings),
    servings_label: draft.servings_label,
    prep_minutes: toNumber(draft.prep_minutes),
    cook_minutes: toNumber(draft.cook_minutes),
    ingredients: draft.ingredients,
    steps: draft.steps,
  };
}

/** The recipe's ingredient lines exactly as written, with "For the sauce:" headers restored. */
export function formatIngredientLines(
  ingredients: { group_label: string | null; raw_text: string }[],
): string {
  const lines: string[] = [];
  let group: string | null = null;
  for (const ingredient of ingredients) {
    if (ingredient.group_label !== group) {
      group = ingredient.group_label;
      if (group) lines.push(`${group}:`);
    }
    // Two ingredients parsed from one line ("salt & pepper") share a raw_text; list it once.
    if (lines[lines.length - 1] !== ingredient.raw_text) lines.push(ingredient.raw_text);
  }
  return lines.join("\n");
}
