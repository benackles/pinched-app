"use client";

import { ImagePlus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { OfflineNote } from "@/components/common/offline-note";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { MAX_PHOTO_INPUT_BYTES, UploadError, preparePhoto, putFile } from "@/lib/media/browser";
import { FILE_ACCEPT, validateUpload } from "@/lib/media/upload";
import { attachMedia, deleteMedia, requestMediaUpload } from "@/server/actions/media";

export type MediaView = {
  id: string;
  kind: "photo" | "video";
  /** A short-lived signed link; null when the file could not be found. */
  url: string | null;
};

type Upload = { name: string; progress: number; stage: "preparing" | "sending" | "saving" };

/** The "Photos" tab: your own pictures and clips of this recipe. Free accounts get one per recipe. */
export function RecipePhotos({
  recipeId,
  title,
  items,
  limit,
}: {
  recipeId: string;
  title: string;
  items: MediaView[];
  /** Free accounts' cap per recipe; null on Pro. */
  limit: number | null;
}) {
  const router = useRouter();
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [removing, setRemoving] = useState<MediaView | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const atLimit = limit !== null && items.length >= limit;
  const busy = upload !== null;

  async function add(file: File) {
    const kindCheck = validateUpload({ contentType: file.type, size: 1 });
    if (!kindCheck.ok) {
      toast.error(kindCheck.message);
      return;
    }
    if (kindCheck.kind === "photo" && file.size > MAX_PHOTO_INPUT_BYTES) {
      toast.error("That photo is too large to use.");
      return;
    }

    const controller = new AbortController();
    cancel.current = controller;
    setUpload({ name: file.name, progress: 0, stage: "preparing" });
    try {
      const prepared = kindCheck.kind === "photo" ? await preparePhoto(file) : file;
      const checked = validateUpload({ contentType: prepared.type, size: prepared.size });
      if (!checked.ok) {
        toast.error(checked.message);
        return;
      }

      const requested = unwrap(
        await requestMediaUpload({
          recipeId,
          contentType: checked.contentType,
          size: prepared.size,
        }),
      );
      if (!requested) return;
      const { path, ticket } = requested.data;

      setUpload({ name: file.name, progress: 0, stage: "sending" });
      await putFile(
        ticket,
        prepared,
        (progress) => setUpload({ name: file.name, progress, stage: "sending" }),
        controller.signal,
      );

      setUpload({ name: file.name, progress: 1, stage: "saving" });
      const attached = unwrap(await attachMedia({ recipeId, path }));
      if (!attached) return;
      toast.success(checked.kind === "photo" ? "Photo added" : "Video added");
      router.refresh();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast("Upload cancelled");
      } else {
        toast.error(error instanceof UploadError ? error.message : "Couldn't add that file.");
      }
    } finally {
      cancel.current = null;
      setUpload(null);
    }
  }

  async function remove() {
    if (!removing) return;
    setRemoveBusy(true);
    const done = unwrap(await deleteMedia({ id: removing.id }), "Removed");
    setRemoveBusy(false);
    if (done) {
      setRemoving(null);
      router.refresh();
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => input.current?.click()}
          disabled={!online || busy || atLimit}
          aria-describedby={atLimit ? "photo-limit" : undefined}
        >
          <ImagePlus aria-hidden /> Add photo or video
        </Button>
        <input
          ref={input}
          type="file"
          accept={FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a photo or video"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // picking the same file again should still fire
            if (file) void add(file);
          }}
        />
        <OfflineNote what="add photos" />
        {limit !== null && !atLimit && (
          <p className="text-sm text-muted-foreground">
            {items.length} of {limit} on the free plan
          </p>
        )}
      </div>

      {atLimit && (
        <p id="photo-limit" className="rounded-2xl bg-secondary p-4 text-sm">
          Free accounts can add {limit === 1 ? "one photo or video" : `${limit} photos or videos`}{" "}
          per recipe.{" "}
          <Link
            href="/settings#billing"
            className="font-semibold text-foreground underline underline-offset-2"
          >
            Pinched Pro has no limit.
          </Link>
        </p>
      )}

      {upload && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card"
          aria-live="polite"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {upload.stage === "preparing"
                ? "Getting it ready…"
                : upload.stage === "saving"
                  ? "Saving…"
                  : `Uploading ${upload.name}`}
            </p>
            <Progress
              className="mt-2 h-2"
              value={Math.round(upload.progress * 100)}
              aria-label="Upload progress"
            />
          </div>
          {upload.stage !== "saving" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel upload"
              onClick={() => cancel.current?.abort()}
            >
              <X />
            </Button>
          )}
        </div>
      )}

      {items.length === 0 && !upload ? (
        <p className="rounded-2xl bg-card p-8 text-center text-muted-foreground shadow-card">
          No photos yet. Add a picture of how yours turned out — it stays private to you.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group relative aspect-square overflow-hidden rounded-2xl bg-secondary shadow-card"
            >
              {item.url === null ? (
                <p className="grid size-full place-content-center p-3 text-center text-sm text-muted-foreground">
                  This file isn&apos;t available right now.
                </p>
              ) : item.kind === "photo" ? (
                <img
                  src={item.url}
                  alt={`Your photo ${index + 1} of ${title}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <video
                  src={item.url}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Your video ${index + 1} of ${title}`}
                  className="size-full bg-black object-cover"
                />
              )}
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute top-2 right-2 shadow-lift"
                aria-label={`Remove ${item.kind} ${index + 1}`}
                disabled={!online}
                onClick={() => setRemoving(item)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {removing?.kind ?? "photo"}?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;s deleted from Pinched for good. The recipe itself isn&apos;t changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeBusy}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
