"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import {
  createCollection,
  deleteCollection,
  renameCollection,
} from "@/server/actions/recipe-extras";

export function NewCollectionForm() {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const online = useOnline();
  return (
    <form
      className="mb-6 flex max-w-md gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const done = unwrap(await createCollection({ name }), "Collection created");
          if (done) setName("");
        });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New collection name"
        aria-label="New collection name"
        className="rounded-full"
        maxLength={80}
      />
      <Button type="submit" disabled={pending || !online || !name.trim()}>
        <Plus aria-hidden /> New collection
      </Button>
    </form>
  );
}

export function CollectionActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  const online = useOnline();

  if (editing) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const done = unwrap(await renameCollection({ id, name: value }), "Renamed");
            if (done) setEditing(false);
          });
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Collection name"
          className="h-11 text-lg"
          maxLength={80}
          autoFocus
        />
        <Button type="submit" disabled={pending || !value.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={!online} onClick={() => setEditing(true)}>
        <Pencil aria-hidden /> Rename
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={!online}>
            <Trash2 aria-hidden /> Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
            <AlertDialogDescription>The recipes stay in your recipe book.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                start(async () => {
                  const done = unwrap(await deleteCollection(id));
                  if (done) {
                    toast.success("Collection deleted");
                    router.push("/recipes?tab=collections");
                  }
                })
              }
            >
              Delete collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
