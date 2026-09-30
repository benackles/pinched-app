"use client";

import { Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { OfflineNote } from "@/components/common/offline-note";
import { offerInstall } from "@/components/pwa/install-prompt";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toastError, unwrap } from "@/lib/actions/client";
import { GROCERY_SECTIONS, KITCHEN_LOCATIONS, type GrocerySection } from "@/lib/domain/constants";
import { parseLooseNumber } from "@/lib/domain/quick-add";
import { formatQuantity } from "@/lib/domain/units";
import { pluralize } from "@/lib/format";
import { groceryAmount, kitchenLocationFor, type GroceryItemView } from "@/lib/grocery-view";
import { now } from "@/lib/offline/clock";
import { enqueue, pendingValues } from "@/lib/offline/queue";
import { useQueueEntries } from "@/lib/offline/use-queue";
import { cn } from "@/lib/utils";
import { addPurchasedToKitchen } from "@/server/actions/kitchen";
import {
  addCustomGroceryItem,
  editGroceryItem,
  removeGroceryItem,
  restoreGroceryItem,
  setGroceryChecked,
  setGroceryOwned,
} from "@/server/actions/grocery";
import { regenerateGrocery } from "@/server/actions/generate";

// ─────────────────────────────── list ───────────────────────────────

export function GroceryList({
  userId,
  weekStart,
  items,
  removed,
}: {
  userId: string;
  weekStart: string;
  items: GroceryItemView[];
  removed: { id: string; name: string }[];
}) {
  const online = useOnline();
  const queuedEntries = useQueueEntries(userId);
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<GroceryItemView | null>(null);
  const [bought, setBought] = useState<GroceryItemView | null>(null);

  // What was checked while offline but hasn't synced yet, plus taps still in flight.
  const queued = useMemo(() => pendingValues(queuedEntries, "grocery.check"), [queuedEntries]);
  const [local, setLocal] = useState<Map<string, boolean>>(new Map());
  const isChecked = (item: GroceryItemView) =>
    local.get(item.id) ?? queued.get(item.id) ?? item.is_checked;
  const settle = (id: string) =>
    setLocal((m) => {
      const copy = new Map(m);
      copy.delete(id);
      return copy;
    });

  async function toggle(item: GroceryItemView) {
    const next = !isChecked(item);
    const at = now();
    const queue = () =>
      enqueue(userId, { kind: "grocery.check", targetId: item.id, value: next }, at);
    setLocal((m) => new Map(m).set(item.id, next));

    if (!navigator.onLine) {
      await queue();
      settle(item.id);
      return;
    }
    try {
      const result = await setGroceryChecked({ id: item.id, checked: next, at });
      settle(item.id);
      if (!result.ok) {
        toastError(result.error);
        return;
      }
      if (next) {
        toast(`Got ${item.name}`, {
          action: { label: "Add to Kitchen", onClick: () => setBought(item) },
        });
      }
    } catch {
      // Lost the connection mid-tap: keep the change and send it later.
      await queue();
      settle(item.id);
    }
  }

  const owned = (item: GroceryItemView, value: boolean) =>
    start(async () => {
      unwrap(await setGroceryOwned({ id: item.id, owned: value }));
    });

  const remove = (item: GroceryItemView) =>
    start(async () => {
      const done = unwrap(await removeGroceryItem(item.id));
      if (!done) return;
      toast(`Removed ${item.name}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            if (done.data.wasCustom) {
              // A custom item is deleted outright; re-add it as typed.
              unwrap(
                await addCustomGroceryItem({
                  weekStart,
                  text: `${groceryAmount(item)} ${item.name}`.trim(),
                  section: item.section,
                }),
              );
            } else unwrap(await restoreGroceryItem(item.id));
          },
        },
      });
    });

  const toBuy = useMemo(() => items.filter((i) => !i.is_already_owned), [items]);
  const ownedItems = items.filter((i) => i.is_already_owned);

  return (
    <>
      {!online && (
        <div className="mb-4 rounded-xl bg-secondary p-3 text-sm">
          You&apos;re offline. You can still check items off — they&apos;ll sync when you&apos;re
          back.
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        {GROCERY_SECTIONS.map((section) => {
          const list = toBuy.filter((i) => i.section === section);
          if (list.length === 0) return null;
          return (
            <section
              key={section}
              aria-labelledby={`aisle-${section}`}
              className="rounded-2xl bg-card p-5 shadow-card"
            >
              <h2 id={`aisle-${section}`} className="mb-3 text-xl font-semibold">
                {section}
              </h2>
              <ul className="space-y-1">
                {list.map((item) => {
                  const checked = isChecked(item);
                  const amount = groceryAmount(item);
                  return (
                    <li key={item.id} className="flex items-start gap-3 py-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => void toggle(item)}
                        className="mt-1 size-5"
                        aria-label={`Got ${amount ? `${amount} ` : ""}${item.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={cn(checked && "text-muted-foreground line-through")}>
                          <button
                            type="button"
                            className="text-left font-medium hover:underline disabled:no-underline"
                            disabled={!online}
                            onClick={() => setEdit(item)}
                            aria-label={`Edit ${item.name}`}
                          >
                            {amount && <span>{amount} </span>}
                            {item.name}
                          </button>
                          {item.sources.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              For {item.sources.join(", ")}
                            </p>
                          )}
                          {item.is_custom && item.sources.length === 0 && (
                            <p className="text-xs text-muted-foreground">Added by you</p>
                          )}
                        </div>
                        <button
                          type="button"
                          className="mt-1 inline-flex min-h-7 items-center text-xs font-semibold text-primary-strong underline-offset-2 hover:underline disabled:opacity-50 pointer-coarse:min-h-11"
                          disabled={!online || pending}
                          onClick={() => owned(item, true)}
                          aria-label={`I already have ${item.name}`}
                        >
                          Already have it
                        </button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${item.name}`}
                        disabled={!online || pending}
                        onClick={() => remove(item)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {ownedItems.length > 0 && (
        <section className="mt-8" aria-labelledby="already-have">
          <h2 id="already-have" className="mb-3 text-xl font-semibold text-muted-foreground">
            Already have
          </h2>
          <ul className="flex flex-wrap gap-2">
            {ownedItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!online || pending}
                  onClick={() => owned(item, false)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm pointer-coarse:min-h-11"
                  title="Move back to the list"
                >
                  {item.name} <Undo2 className="size-3.5" aria-hidden />
                  <span className="sr-only">— move back to the list</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer font-semibold text-muted-foreground">
            Removed ({removed.length})
          </summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {removed.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!online || pending}
                  onClick={() =>
                    start(async () => {
                      unwrap(await restoreGroceryItem(item.id), `Restored ${item.name}`);
                    })
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 pointer-coarse:min-h-11"
                >
                  {item.name} <Undo2 className="size-3.5" aria-hidden />
                  <span className="sr-only">— put back on the list</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {edit && <EditItemDialog key={edit.id} item={edit} onClose={() => setEdit(null)} />}
      {bought && (
        <AddToKitchenDialog key={bought.id} item={bought} onClose={() => setBought(null)} />
      )}
    </>
  );
}

// ─────────────────────────────── add custom item ───────────────────────────────

export function AddCustomForm({ weekStart }: { weekStart: string }) {
  const [text, setText] = useState("");
  const [section, setSection] = useState<GrocerySection>("Other");
  const [pending, start] = useTransition();
  const online = useOnline();

  return (
    <form
      className="mb-6 flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        start(async () => {
          const done = unwrap(await addCustomGroceryItem({ weekStart, text, section }));
          if (done) setText("");
        });
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add an item — 2 limes, paper towels"
        aria-label="Add your own grocery item"
        className="h-11 min-w-0 basis-full rounded-full px-5 sm:flex-1 sm:basis-0"
        disabled={!online}
        autoComplete="off"
      />
      <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
        <NativeSelect
          aria-label="Aisle"
          value={section}
          onChange={(e) => setSection(e.target.value as GrocerySection)}
          className="h-11 rounded-full"
          disabled={!online}
        >
          {GROCERY_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "Other" ? "Auto aisle" : s}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" aria-label="Add item" disabled={pending || !online || !text.trim()}>
        <Plus aria-hidden /> Add
      </Button>
    </form>
  );
}

// ─────────────────────────────── edit item ───────────────────────────────

function EditItemDialog({ item, onClose }: { item: GroceryItemView; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(
    item.quantity === null ? "" : formatQuantity(item.quantity),
  );
  const [unit, setUnit] = useState(item.unit ?? "");
  const [section, setSection] = useState<GrocerySection>(item.section);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const parsed = quantity.trim() === "" ? null : parseLooseNumber(quantity);
    if (quantity.trim() !== "" && parsed === null) {
      setError("Enter a number like 2, 1½ or 3/4 — or leave it blank.");
      return;
    }
    setError(null);
    start(async () => {
      const done = unwrap(
        await editGroceryItem({ id: item.id, name, quantity: parsed, unit: unit || null, section }),
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
          <DialogDescription>
            {item.is_custom
              ? "Your own item."
              : "Your changes stick, even when you regenerate the list."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-2">
            <Label htmlFor="g-name">Name</Label>
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="g-qty">Quantity</Label>
            <Input
              id="g-qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="g-unit">Unit</Label>
            <Input id="g-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          {error && (
            <div className="col-span-2">
              <FieldError>{error}</FieldError>
            </div>
          )}
          <div className="col-span-2 space-y-2">
            <Label htmlFor="g-section">Aisle</Label>
            <NativeSelect
              id="g-section"
              value={section}
              onChange={(e) => setSection(e.target.value as GrocerySection)}
            >
              {GROCERY_SECTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
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

// ─────────────────────────────── add to kitchen ───────────────────────────────

/** After checking an item off: offer to add it to the kitchen, with the amount confirmed. */
function AddToKitchenDialog({ item, onClose }: { item: GroceryItemView; onClose: () => void }) {
  const [quantity, setQuantity] = useState(
    item.quantity === null ? "" : formatQuantity(item.quantity),
  );
  const [unit, setUnit] = useState(item.unit ?? "");
  const [location, setLocation] = useState<string>(kitchenLocationFor(item.section));
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
        await addPurchasedToKitchen({
          name: item.name,
          quantity: parsed,
          unit: unit || null,
          location: location as (typeof KITCHEN_LOCATIONS)[number],
        }),
        "Added to your kitchen",
      );
      if (done) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Add to Kitchen</DialogTitle>
          <DialogDescription>
            How much {item.name} did you bring home? Pinched won&apos;t change your kitchen on its
            own.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ak-qty">Quantity</Label>
            <Input
              id="ak-qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="some"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ak-unit">Unit</Label>
            <Input id="ak-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          {error && (
            <div className="col-span-2">
              <FieldError>{error}</FieldError>
            </div>
          )}
          <div className="col-span-2 space-y-2">
            <Label htmlFor="ak-loc">Where does it go?</Label>
            <NativeSelect
              id="ak-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {KITCHEN_LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {l[0]!.toUpperCase() + l.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={save} disabled={pending}>
            Add to Kitchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────── generation ───────────────────────────────

/** Builds or rebuilds the list (manual edits are kept). */
export function RegenerateGroceryButton({
  weekStart,
  label,
  variant = "outline",
}: {
  weekStart: string;
  label: string;
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const online = useOnline();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={variant}
        disabled={pending || !online}
        onClick={() =>
          start(async () => {
            const done = unwrap(await regenerateGrocery({ weekStart }));
            if (!done) return;
            const { added, removed, changed, toBuy, created } = done.data;
            if (created) offerInstall();
            const parts = [
              added && `${added} added`,
              removed && `${removed} removed`,
              changed && `${changed} updated`,
            ].filter(Boolean);
            toast.success(
              parts.length
                ? `List updated — ${parts.join(", ")}`
                : `List is up to date — ${pluralize(toBuy, "item")} to buy`,
            );
            router.refresh();
          })
        }
      >
        <RefreshCw
          aria-hidden
          className={cn(pending && "animate-spin motion-reduce:animate-none")}
        />{" "}
        {label}
      </Button>
      {!online && <OfflineNote what="update the list" />}
    </div>
  );
}

/** "Your plan changed" — shown when regenerating would change the list. */
export function UpdateBanner({
  weekStart,
  added,
  removed,
  changed,
}: {
  weekStart: string;
  added: number;
  removed: number;
  changed: number;
}) {
  const parts = [
    added && `${added} new`,
    removed && `${removed} no longer needed`,
    changed && `${changed} changed`,
  ].filter(Boolean);
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-accent p-4 text-accent-foreground">
      <p className="text-sm font-medium">
        Your plan changed since this list was made — {parts.join(", ")}. Your edits will be kept.
      </p>
      <RegenerateGroceryButton weekStart={weekStart} label="Update list" variant="default" />
    </div>
  );
}
