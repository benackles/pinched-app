"use client";

import { Link2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/form-controls";
import { useOnline } from "@/hooks/use-online";
import { toastError } from "@/lib/actions/client";
import { previewImport, type ImportPreview } from "@/server/actions/recipes";

import { RecipeForm } from "./recipe-form";

/** Paste a link → preview the parsed recipe → confirm to save. Nothing is stored until you confirm. */
export function ImportDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const online = useOnline();

  function reset() {
    setPreview(null);
    setError(null);
  }

  function fetchPreview(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await previewImport({ url });
      if (!result.ok) {
        if (result.error.code === "validation") setError(result.error.message);
        else toastError(result.error);
        return;
      }
      setPreview(result.data);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!online}>
          <Link2 aria-hidden /> Import from URL
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Import a recipe</DialogTitle>
          <DialogDescription>
            Paste a link to one recipe page. We read its ingredients and steps — you check them
            before anything is saved, and the original is credited.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <form onSubmit={fetchPreview} className="space-y-3" noValidate>
            <Label htmlFor="import-url">Recipe link</Label>
            <div className="flex gap-2">
              <Input
                id="import-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/best-lentil-soup"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "import-url-error" : undefined}
                autoFocus
              />
              <Button type="submit" disabled={pending || !url.trim()}>
                {pending ? "Reading…" : "Preview"}
              </Button>
            </div>
            <FieldError id="import-url-error">{error}</FieldError>
          </form>
        ) : (
          <div className="space-y-4">
            {preview.existingRecipeId && (
              <p className="rounded-xl bg-accent p-3 text-sm text-accent-foreground">
                You&apos;ve already imported this page.{" "}
                <Link
                  className="font-semibold underline"
                  href={`/recipes/${preview.existingRecipeId}`}
                >
                  Open it
                </Link>
              </p>
            )}
            {preview.kind === "manual" && (
              <p className="rounded-xl bg-muted p-3 text-sm">
                {preview.message} You can type the recipe in yourself — we&apos;ve filled in the
                title and link.
              </p>
            )}
            <RecipeForm
              mode={preview.kind === "recipe" ? "import" : "create"}
              initial={preview.draft}
              warnings={preview.kind === "recipe" ? preview.warnings : []}
            />
            <Button variant="ghost" onClick={reset}>
              Try a different link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
