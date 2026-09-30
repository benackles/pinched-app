"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { OfflineNote } from "@/components/common/offline-note";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/form-controls";
import { useOnline } from "@/hooks/use-online";
import { toastError } from "@/lib/actions/client";
import type { ActionResult } from "@/lib/actions/types";
import { draftToInput, type RecipeDraft } from "@/lib/recipes/draft";
import { confirmImport, createManualRecipe, updateOwnRecipe } from "@/server/actions/recipes";

type Mode = "create" | "import" | "edit";

const LABELS: Record<Mode, { submit: string; saving: string }> = {
  create: { submit: "Save recipe", saving: "Saving…" },
  import: { submit: "Save to my recipes", saving: "Saving…" },
  edit: { submit: "Save changes", saving: "Saving…" },
};

/**
 * One form for typing a recipe, confirming a URL import and editing your own recipe. Ingredients
 * and steps are one per line — paste them straight from a cookbook or a note.
 */
export function RecipeForm({
  mode,
  initial,
  recipeId,
  warnings = [],
}: {
  mode: Mode;
  initial: RecipeDraft;
  recipeId?: string;
  warnings?: string[];
}) {
  const router = useRouter();
  const online = useOnline();
  const [draft, setDraft] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFields({});
    const input = draftToInput(draft);
    start(async () => {
      let result: ActionResult<{ recipeId: string; alreadyImported?: boolean }>;
      if (mode === "edit" && recipeId) result = await updateOwnRecipe(recipeId, input);
      else if (mode === "import") result = await confirmImport(input);
      else result = await createManualRecipe(input);

      if (!result.ok) {
        setFields(result.error.fields ?? {});
        toastError(result.error);
        return;
      }
      if (result.data.alreadyImported) toast("You had already imported this page — opening it.");
      else toast.success(mode === "edit" ? "Recipe updated" : "Recipe saved");
      router.push(`/recipes/${result.data.recipeId}`);
    });
  }

  const err = (key: string) => fields[key];
  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {warnings.length > 0 && (
        <div className="rounded-2xl bg-accent p-4 text-sm text-accent-foreground" role="note">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden /> Worth a second look
          </p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="r-title">Title</Label>
        <Input
          id="r-title"
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          aria-invalid={err("title") ? true : undefined}
          aria-describedby={err("title") ? "r-title-error" : undefined}
          maxLength={140}
          className="h-12 text-lg"
          autoComplete="off"
        />
        <FieldError id="r-title-error">{err("title")}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="r-servings">Servings</Label>
          <Input
            id="r-servings"
            inputMode="numeric"
            value={draft.servings}
            onChange={(e) => set("servings", e.target.value)}
            placeholder="4"
            aria-invalid={err("servings") ? true : undefined}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank if unknown — quantities are then used as written.
          </p>
          <FieldError>{err("servings")}</FieldError>
        </div>
        <div className="space-y-2">
          <Label htmlFor="r-prep">Prep minutes</Label>
          <Input
            id="r-prep"
            inputMode="numeric"
            value={draft.prep_minutes}
            onChange={(e) => set("prep_minutes", e.target.value)}
            placeholder="15"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="r-cook">Cook minutes</Label>
          <Input
            id="r-cook"
            inputMode="numeric"
            value={draft.cook_minutes}
            onChange={(e) => set("cook_minutes", e.target.value)}
            placeholder="30"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r-ingredients">Ingredients</Label>
        <Textarea
          id="r-ingredients"
          value={draft.ingredients}
          onChange={(e) => set("ingredients", e.target.value)}
          rows={10}
          placeholder={
            "2 cups jasmine rice\n1 lb chicken thighs, diced\nFor the sauce:\n2 tbsp soy sauce"
          }
          aria-invalid={err("ingredients") ? true : undefined}
          aria-describedby="r-ingredients-help"
          className="font-mono text-sm"
        />
        <p id="r-ingredients-help" className="text-xs text-muted-foreground">
          One per line. A line ending in a colon (“For the sauce:”) groups the ones below it.
        </p>
        <FieldError>{err("ingredients")}</FieldError>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r-steps">Steps</Label>
        <Textarea
          id="r-steps"
          value={draft.steps}
          onChange={(e) => set("steps", e.target.value)}
          rows={8}
          placeholder={
            "Heat the oven to 400°F.\nToss everything with oil and roast for 25 minutes."
          }
          aria-invalid={err("steps") ? true : undefined}
          aria-describedby="r-steps-help"
        />
        <p id="r-steps-help" className="text-xs text-muted-foreground">
          One per line — numbers at the start are fine, we&apos;ll handle them.
        </p>
        <FieldError>{err("steps")}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="r-author">
            Credit <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="r-author"
            value={draft.author}
            onChange={(e) => set("author", e.target.value)}
            placeholder="Grandma June, a cookbook, a site…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="r-source">
            Source link <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="r-source"
            type="url"
            value={draft.source_url}
            onChange={(e) => set("source_url", e.target.value)}
            readOnly={mode === "import"}
            aria-invalid={err("source_url") ? true : undefined}
            placeholder="https://"
          />
          <FieldError>{err("source_url")}</FieldError>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || !online}>
          {pending ? LABELS[mode].saving : LABELS[mode].submit}
        </Button>
        <OfflineNote what="save" />
      </div>
    </form>
  );
}
