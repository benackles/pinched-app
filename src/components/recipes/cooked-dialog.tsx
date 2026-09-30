"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/form-controls";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { logCooked } from "@/server/actions/recipe-extras";

import { StarRating } from "./star-rating";

/** Mark as cooked: date, rating, optional note. Lands in the recipe's cooking history. */
export function CookedDialog({
  recipeId,
  plannedMealId,
  today,
  open,
  onOpenChange,
  onLogged,
}: {
  recipeId: string;
  plannedMealId?: string | null;
  /** Today's date in the person's timezone (the default). */
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save — the cook view uses it to offer "update kitchen". */
  onLogged?: () => void;
}) {
  const [date, setDate] = useState(today);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const online = useOnline();

  function save() {
    start(async () => {
      const done = unwrap(
        await logCooked({
          recipeId,
          plannedMealId: plannedMealId ?? null,
          cookedOn: date,
          rating,
          note,
        }),
        "Logged to your cooking history",
      );
      if (!done) return;
      setRating(null);
      setNote("");
      onOpenChange(false);
      onLogged?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Mark as cooked</DialogTitle>
          <DialogDescription>Your rating and note stay private, on your recipe.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="cooked-date">Date cooked</Label>
            <Input
              id="cooked-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label id="cooked-rating-label">Rating</Label>
            <div>
              <StarRating value={rating} onChange={(n) => setRating(n || null)} size="lg" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cooked-note">Note (optional)</Label>
            <Textarea
              id="cooked-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Used less chili and it was perfect."
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || !date || !online}>
            {online ? "Save" : "Offline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
