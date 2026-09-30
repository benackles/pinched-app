"use client";

import { Ban, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { OfflineNote } from "@/components/common/offline-note";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, Input, Label, NativeSelect } from "@/components/ui/form-controls";
import { useOnline } from "@/hooks/use-online";
import { unwrap } from "@/lib/actions/client";
import { KITCHEN_LOCATIONS, type KitchenLocation } from "@/lib/domain/constants";
import { parseLooseNumber } from "@/lib/domain/quick-add";
import { formatQuantity, unitLabel } from "@/lib/domain/units";
import { shortDate } from "@/lib/domain/week";
import { cn } from "@/lib/utils";
import {
  deleteKitchenItem,
  quickAddKitchen,
  setKitchenOut,
  updateKitchenItem,
} from "@/server/actions/kitchen";

export type KitchenRow = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  location: string;
  expires_at: string | null;
  note: string | null;
  /** Use-by date within three days (computed on the server in the person's timezone). */
  useSoon: boolean;
};

export function QuickAdd({ location }: { location: KitchenLocation | null }) {
  const [text, setText] = useState("");
  const [, start] = useTransition();
  const online = useOnline();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const entered = text.trim();
    if (!entered) return;
    // Ready for the next item straight away — people add a dozen in a row. If this one fails it
    // goes back in the box (unless they have already started typing something else).
    setText("");
    start(async () => {
      const done = unwrap(await quickAddKitchen({ text: entered, location }));
      if (!done) {
        setText((current) => current || entered);
        return;
      }
      const { names, added, merged, had } = done.data;
      toast.success(
        names.length === 1
          ? added
            ? `Added ${names[0]}`
            : merged
              ? `Updated ${names[0]}`
              : `${names[0]} is already in your kitchen`
          : `Added ${names.length} items`,
      );
      void had;
    });
  }

  return (
    <form onSubmit={submit} className="mb-6 flex gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add something you have — 2 onions, 1 lb chicken thighs, rice"
        className="h-12 rounded-full px-5"
        aria-label="Add a kitchen item"
        disabled={!online}
        autoComplete="off"
        enterKeyHint="done"
      />
      <Button
        type="submit"
        size="lg"
        aria-label="Add"
        // Not disabled while saving: a disabled submit button also blocks Enter, so typing the next item would do nothing.
        disabled={!online || !text.trim()}
      >
        <Plus />
      </Button>
    </form>
  );
}

function qtyLabel(row: KitchenRow): string {
  if (row.quantity === null || row.quantity <= 0) return "";
  return `${formatQuantity(row.quantity)}${row.unit ? ` ${unitLabel(row.unit, row.quantity)}` : ""} `;
}

export function KitchenList({ rows }: { rows: KitchenRow[] }) {
  const [editing, setEditing] = useState<KitchenRow | null>(null);
  const [pending, start] = useTransition();
  const online = useOnline();

  const out = (row: KitchenRow, value: boolean) =>
    start(async () => {
      unwrap(await setKitchenOut({ id: row.id, out: value }));
    });
  const remove = (row: KitchenRow) =>
    start(async () => {
      const done = unwrap(await deleteKitchenItem(row.id));
      if (done) toast.success(`Removed ${row.name}`);
    });

  return (
    <>
      {!online && (
        <div className="mb-3">
          <OfflineNote what="edit your kitchen" />
        </div>
      )}
      <ul className="divide-y overflow-hidden rounded-2xl bg-card shadow-card">
        {rows.map((row) => {
          const isOut = row.quantity !== null && row.quantity <= 0;
          return (
            <li key={row.id} className="flex items-center gap-2 px-4 py-3">
              <div className={cn("min-w-0 flex-1", isOut && "opacity-60")}>
                <p className={cn("font-medium", isOut && "line-through")}>
                  {qtyLabel(row)}
                  {row.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="capitalize">{row.location}</span>
                  {isOut && " · out"}
                  {row.expires_at && ` · use by ${shortDate(row.expires_at)}`}
                  {row.useSoon && !isOut && (
                    <span className="font-semibold text-primary-strong"> · use soon</span>
                  )}
                  {row.note && ` · ${row.note}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${row.name}`}
                disabled={!online}
                onClick={() => setEditing(row)}
              >
                <Pencil />
              </Button>
              {isOut ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${row.name} is back in stock`}
                  disabled={!online || pending}
                  onClick={() => out(row, false)}
                >
                  <RotateCcw />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Mark ${row.name} out`}
                  disabled={!online || pending}
                  onClick={() => out(row, true)}
                >
                  <Ban />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${row.name}`}
                disabled={!online || pending}
                onClick={() => remove(row)}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <EditKitchenItem key={editing.id} row={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function EditKitchenItem({ row, onClose }: { row: KitchenRow; onClose: () => void }) {
  const [name, setName] = useState(row.name);
  const [quantity, setQuantity] = useState(
    row.quantity === null ? "" : formatQuantity(row.quantity),
  );
  const [unit, setUnit] = useState(row.unit ?? "");
  const [location, setLocation] = useState(row.location);
  const [expires, setExpires] = useState(row.expires_at ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const parsed = quantity.trim() === "" ? null : parseLooseNumber(quantity);
    if (quantity.trim() !== "" && parsed === null) {
      setError("Enter a number like 2, 1½ or 3/4 — or leave it blank for “some”.");
      return;
    }
    setError(null);
    start(async () => {
      const done = unwrap(
        await updateKitchenItem({
          id: row.id,
          name,
          quantity: parsed,
          unit: unit || null,
          location: location as KitchenLocation,
          expires_at: expires || null,
          note: note || null,
        }),
        "Saved",
      );
      if (done) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Edit item</DialogTitle>
          <DialogDescription>Leave the quantity blank if you just have “some”.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-2">
            <Label htmlFor="k-name">Name</Label>
            <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-qty">Quantity</Label>
            <Input
              id="k-qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="some"
              inputMode="decimal"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "k-qty-error" : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-unit">Unit</Label>
            <Input
              id="k-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="lb, cup…"
            />
          </div>
          {error && (
            <div className="col-span-2">
              <FieldError id="k-qty-error">{error}</FieldError>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="k-loc">Location</Label>
            <NativeSelect id="k-loc" value={location} onChange={(e) => setLocation(e.target.value)}>
              {KITCHEN_LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {l[0]!.toUpperCase() + l.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-exp">Use by</Label>
            <Input
              id="k-exp"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="k-note">Note</Label>
            <Input
              id="k-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || !name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
