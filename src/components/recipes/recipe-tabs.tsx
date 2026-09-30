"use client";

import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { OfflineNote } from "@/components/common/offline-note";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/form-controls";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOnline } from "@/hooks/use-online";
import { toastError, unwrap } from "@/lib/actions/client";
import { formatIngredient } from "@/lib/domain/ingredients";
import { scaleFactor, scaleIngredient } from "@/lib/domain/scaling";
import {
  addNote,
  deleteNote,
  resetVersion,
  saveVersion,
  updateNote,
} from "@/server/actions/recipe-extras";

import { StarRating } from "./star-rating";

export type IngredientView = {
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  raw_text: string;
  group_label: string | null;
};

export type VersionView = {
  title: string;
  servings: number | null;
  total_minutes: number | null;
  ingredients: string;
  steps: string;
};

export type NoteView = { id: string; text: string; created_at: string };
export type CookingView = {
  id: string;
  cooked_at: string;
  rating: number | null;
  note: string | null;
};

type Props = {
  recipeId: string;
  baseServings: number | null;
  servingsLabel: string | null;
  ingredients: IngredientView[];
  steps: string[];
  /** What "create my version" starts from — the original, as editable text. */
  original: VersionView;
  /** The saved personal version, if any. */
  version: VersionView | null;
  notes: NoteView[];
  cooking: CookingView[];
  /** The Photos tab's content; omitted for recipes that aren't in the person's book. */
  photos?: React.ReactNode;
  photoCount?: number;
};

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );

export function RecipeTabs({ photos, photoCount = 0, ...props }: Props) {
  return (
    <Tabs defaultValue="recipe" className="mt-10">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="recipe">Recipe</TabsTrigger>
        <TabsTrigger value="version">My Version{props.version ? " ✓" : ""}</TabsTrigger>
        <TabsTrigger value="notes">
          Notes{props.notes.length ? ` (${props.notes.length})` : ""}
        </TabsTrigger>
        <TabsTrigger value="history">
          History{props.cooking.length ? ` (${props.cooking.length})` : ""}
        </TabsTrigger>
        {photos && (
          <TabsTrigger value="photos">Photos{photoCount ? ` (${photoCount})` : ""}</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="recipe" className="mt-6">
        <RecipeBody {...props} />
      </TabsContent>
      <TabsContent value="version" className="mt-6">
        <MyVersion recipeId={props.recipeId} original={props.original} version={props.version} />
      </TabsContent>
      <TabsContent value="notes" className="mt-6">
        <Notes recipeId={props.recipeId} notes={props.notes} />
      </TabsContent>
      <TabsContent value="history" className="mt-6">
        <History cooking={props.cooking} />
      </TabsContent>
      {photos && (
        <TabsContent value="photos" className="mt-6">
          {photos}
        </TabsContent>
      )}
    </Tabs>
  );
}

// ─────────────────────────────── recipe ───────────────────────────────

function RecipeBody({ baseServings, servingsLabel, ingredients, steps, version }: Props) {
  const [servings, setServings] = useState(baseServings);
  const factor = scaleFactor(baseServings, servings ?? baseServings ?? 1);

  const lines = useMemo(() => {
    const out: { key: string; group: string | null; text: string }[] = [];
    let previous = "";
    ingredients.forEach((ingredient, index) => {
      const text = formatIngredient(scaleIngredient(ingredient, factor));
      // "salt & pepper" is stored as two ingredients from one line; show it once.
      if (ingredient.quantity === null && text === previous) return;
      previous = text;
      out.push({ key: `${index}`, group: ingredient.group_label, text });
    });
    return out;
  }, [ingredients, factor]);

  const withHeaders = lines.map((line, index) => ({
    line,
    header: line.group && line.group !== lines[index - 1]?.group ? line.group : null,
  }));
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.6fr]">
      <section aria-labelledby="ingredients-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ingredients-heading" className="text-2xl font-semibold">
            Ingredients
          </h2>
          {baseServings ? (
            <div className="inline-flex items-center gap-1 rounded-full bg-secondary p-1 text-sm">
              <button
                type="button"
                className="hit-44 grid size-7 place-content-center rounded-full hover:bg-card disabled:opacity-40"
                aria-label="Fewer servings"
                disabled={(servings ?? 1) <= 1}
                onClick={() => setServings(Math.max(1, (servings ?? baseServings) - 1))}
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span aria-live="polite" className="min-w-16 text-center font-semibold">
                {servings} {servings === 1 ? "serving" : "servings"}
              </span>
              <button
                type="button"
                className="hit-44 grid size-7 place-content-center rounded-full hover:bg-card disabled:opacity-40"
                aria-label="More servings"
                disabled={(servings ?? 1) >= 99}
                onClick={() => setServings(Math.min(99, (servings ?? baseServings) + 1))}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Amounts as written</p>
          )}
        </div>
        {servingsLabel && <p className="mb-3 text-sm text-muted-foreground">{servingsLabel}</p>}
        <ul className="space-y-2.5">
          {withHeaders.map(({ line, header }) => {
            return (
              <li key={line.key} className={header ? "pt-2" : undefined}>
                {header && (
                  <p className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    {header}
                  </p>
                )}
                <div className="flex gap-3 border-b pb-2.5">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {line.text}
                </div>
              </li>
            );
          })}
        </ul>
        {version && (
          <p className="mt-4 rounded-xl bg-accent p-3 text-sm text-accent-foreground">
            You have your own version of this recipe. Your plan, grocery list and prep plan use it.
          </p>
        )}
      </section>
      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="mb-4 text-2xl font-semibold">
          Instructions
        </h2>
        <ol className="space-y-5">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-4">
              <span className="font-display text-2xl font-semibold text-primary-strong" aria-hidden>
                {index + 1}
              </span>
              <p className="pt-1 leading-relaxed">
                <span className="sr-only">Step {index + 1}: </span>
                {step}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ─────────────────────────────── my version ───────────────────────────────

function MyVersion({
  recipeId,
  original,
  version,
}: {
  recipeId: string;
  original: VersionView;
  version: VersionView | null;
}) {
  const [editing, setEditing] = useState(version !== null);
  const initial = version ?? original;
  const [title, setTitle] = useState(initial.title);
  const [servings, setServings] = useState(
    initial.servings === null ? "" : String(initial.servings),
  );
  const [minutes, setMinutes] = useState(
    initial.total_minutes === null ? "" : String(initial.total_minutes),
  );
  const [ingredients, setIngredients] = useState(initial.ingredients);
  const [steps, setSteps] = useState(initial.steps);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const online = useOnline();

  if (!editing) {
    return (
      <div className="rounded-2xl bg-card p-8 text-center shadow-card md:p-10">
        <p className="font-display text-2xl">Make this recipe yours.</p>
        <p className="mx-auto mt-1 max-w-md text-muted-foreground">
          Change ingredients, amounts or steps without touching the original. Your plan, grocery
          list and prep plan will use your version.
        </p>
        <Button className="mt-4" onClick={() => setEditing(true)}>
          Create my version
        </Button>
      </div>
    );
  }

  const toLines = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const toInt = (value: string) => {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  };

  function save() {
    setFields({});
    start(async () => {
      const result = await saveVersion({
        recipeId,
        title,
        servings: toInt(servings),
        total_minutes: toInt(minutes),
        ingredients: toLines(ingredients),
        steps: toLines(steps).map((s) => s.replace(/^\s*(?:step\s*)?\d+\s*[.):]\s*/i, "")),
      });
      if (!result.ok) {
        setFields(result.error.fields ?? {});
        toastError(result.error);
        return;
      }
      toast.success("Your version is saved");
    });
  }

  function reset() {
    start(async () => {
      const done = unwrap(await resetVersion(recipeId), "Back to the original");
      if (!done) return;
      setTitle(original.title);
      setServings(original.servings === null ? "" : String(original.servings));
      setMinutes(original.total_minutes === null ? "" : String(original.total_minutes));
      setIngredients(original.ingredients);
      setSteps(original.steps);
      setEditing(false);
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-2">
          <Label htmlFor="v-title">Title</Label>
          <Input
            id="v-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
          />
          <FieldError>{fields.title}</FieldError>
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-servings">Servings</Label>
          <Input
            id="v-servings"
            inputMode="numeric"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-minutes">Total minutes</Label>
          <Input
            id="v-minutes"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="v-ingredients">Ingredients</Label>
        <Textarea
          id="v-ingredients"
          rows={10}
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          className="font-mono text-sm"
          aria-describedby="v-ingredients-help"
        />
        <p id="v-ingredients-help" className="text-xs text-muted-foreground">
          One per line — e.g. change “1 tsp chili flakes” to “½ tsp chili flakes”.
        </p>
        <FieldError>{fields.ingredients}</FieldError>
      </div>
      <div className="space-y-2">
        <Label htmlFor="v-steps">Steps</Label>
        <Textarea id="v-steps" rows={8} value={steps} onChange={(e) => setSteps(e.target.value)} />
        <FieldError>{fields.steps}</FieldError>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending || !online}>
          Save my version
        </Button>
        <Button variant="outline" onClick={reset} disabled={pending || !online}>
          {version ? "Reset to original" : "Discard"}
        </Button>
        <OfflineNote what="save" />
      </div>
    </div>
  );
}

// ─────────────────────────────── notes ───────────────────────────────

function Notes({ recipeId, notes }: { recipeId: string; notes: NoteView[] }) {
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pending, start] = useTransition();
  const online = useOnline();

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="new-note" className="sr-only">
          New note
        </Label>
        <Textarea
          id="new-note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a private note — swaps, timing, what the kids thought…"
          maxLength={4000}
        />
        <Button
          disabled={!text.trim() || pending || !online}
          onClick={() =>
            start(async () => {
              const done = unwrap(await addNote({ recipeId, text }));
              if (done) setText("");
            })
          }
        >
          Add note
        </Button>
      </div>
      {notes.map((note) => (
        <div key={note.id} className="rounded-2xl bg-card p-4 shadow-card">
          {editId === note.id ? (
            <div className="space-y-2">
              <Label htmlFor={`edit-${note.id}`} className="sr-only">
                Edit note
              </Label>
              <Textarea
                id={`edit-${note.id}`}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!editText.trim() || pending}
                  onClick={() =>
                    start(async () => {
                      const done = unwrap(
                        await updateNote({ recipeId, id: note.id, text: editText }),
                      );
                      if (done) setEditId(null);
                    })
                  }
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap">{note.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(note.created_at)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit note"
                disabled={!online}
                onClick={() => {
                  setEditId(note.id);
                  setEditText(note.text);
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete note"
                disabled={!online || pending}
                onClick={() =>
                  start(async () => {
                    unwrap(await deleteNote({ recipeId, id: note.id }));
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────── history ───────────────────────────────

function History({ cooking }: { cooking: CookingView[] }) {
  if (cooking.length === 0) {
    return (
      <p className="rounded-2xl bg-card p-8 text-center text-muted-foreground shadow-card">
        You haven&apos;t cooked this one yet. Use “Mark as cooked” when you do.
      </p>
    );
  }
  return (
    <ul className="max-w-2xl space-y-3">
      {cooking.map((event) => (
        <li key={event.id} className="rounded-2xl bg-card p-5 shadow-card">
          <p className="font-semibold">{formatDate(event.cooked_at)}</p>
          {event.rating ? <StarRating value={event.rating} /> : null}
          {event.note && <p className="mt-1 text-muted-foreground">{event.note}</p>}
        </li>
      ))}
    </ul>
  );
}
