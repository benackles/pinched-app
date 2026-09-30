"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { OfflineNote } from "@/components/common/offline-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, Input, Label, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { Progress } from "@/components/ui/progress";
import { useOnline } from "@/hooks/use-online";
import { toastError, unwrap } from "@/lib/actions/client";
import { pluralize } from "@/lib/format";
import { now } from "@/lib/offline/clock";
import { enqueue, pendingValues } from "@/lib/offline/queue";
import { useQueueEntries } from "@/lib/offline/use-queue";
import { cn } from "@/lib/utils";
import { regeneratePrep } from "@/server/actions/generate";
import {
  addPrepTask,
  changePrepDay,
  deletePrepTask,
  editPrepTask,
  movePrepTask,
  restorePrepTask,
  setPrepTaskCompleted,
} from "@/server/actions/prep";

export type PrepTaskView = {
  id: string;
  title: string;
  description: string | null;
  minutes: number;
  is_passive: boolean;
  is_completed: boolean;
  is_custom: boolean;
  /** "Turkey Patties (Tue), Chicken Curry (Wed)" */
  usedIn: string;
};

// ─────────────────────────────── task list ───────────────────────────────

export function PrepChecklist({
  userId,
  weekStart,
  tasks,
}: {
  userId: string;
  weekStart: string;
  tasks: PrepTaskView[];
}) {
  const online = useOnline();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<PrepTaskView | "new" | null>(null);

  const queuedEntries = useQueueEntries(userId);
  const queued = useMemo(() => pendingValues(queuedEntries, "prep.complete"), [queuedEntries]);
  const [local, setLocal] = useState<Map<string, boolean>>(new Map());
  const isDone = (task: PrepTaskView) =>
    local.get(task.id) ?? queued.get(task.id) ?? task.is_completed;
  const settle = (id: string) =>
    setLocal((m) => {
      const copy = new Map(m);
      copy.delete(id);
      return copy;
    });

  const done = tasks.filter(isDone).length;
  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  async function toggle(task: PrepTaskView) {
    const next = !isDone(task);
    const at = now();
    const queue = () =>
      enqueue(userId, { kind: "prep.complete", targetId: task.id, value: next }, at);
    setLocal((m) => new Map(m).set(task.id, next));
    if (!navigator.onLine) {
      await queue();
      settle(task.id);
      return;
    }
    try {
      const result = await setPrepTaskCompleted({ id: task.id, completed: next, at });
      settle(task.id);
      if (!result.ok) toastError(result.error);
    } catch {
      await queue();
      settle(task.id);
    }
  }

  const move = (task: PrepTaskView, direction: "up" | "down") =>
    start(async () => {
      unwrap(await movePrepTask({ id: task.id, direction }));
    });

  const remove = (task: PrepTaskView) =>
    start(async () => {
      const result = unwrap(await deletePrepTask(task.id));
      if (!result) return;
      toast(`Deleted ${task.title}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            if (result.data.wasCustom) {
              unwrap(
                await addPrepTask({
                  weekStart,
                  title: task.title,
                  description: task.description,
                  minutes: task.minutes,
                }),
              );
            } else unwrap(await restorePrepTask(task.id));
          },
        },
      });
    });

  return (
    <>
      <div className="mb-6 rounded-2xl bg-card p-5 shadow-card">
        <div className="mb-2 flex justify-between text-sm font-medium">
          <span>
            {done} of {tasks.length} complete
          </span>
          <span className="text-muted-foreground">{percent}%</span>
        </div>
        <Progress value={percent} className="h-3" aria-label="Prep progress" />
        <p className="mt-2 text-xs text-muted-foreground">
          {total - tasks.filter(isDone).reduce((sum, t) => sum + t.minutes, 0)} min left
        </p>
      </div>

      {!online && (
        <div className="mb-4 rounded-xl bg-secondary p-3 text-sm">
          You&apos;re offline. You can still tick tasks off — they&apos;ll sync when you&apos;re
          back.
        </div>
      )}

      <ol className="space-y-3">
        {tasks.map((task, index) => {
          const completed = isDone(task);
          return (
            <li
              key={task.id}
              className={cn(
                "flex items-start gap-4 rounded-2xl bg-card p-4 shadow-card",
                completed && "opacity-70",
              )}
            >
              <Checkbox
                checked={completed}
                onCheckedChange={() => void toggle(task)}
                className="mt-1 size-6"
                aria-label={`${completed ? "Undo" : "Complete"} ${task.title}`}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-lg font-semibold", completed && "line-through")}>
                  {task.title}{" "}
                  <span className="font-normal text-muted-foreground">— {task.minutes} min</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {task.is_passive && <Badge variant="secondary">Mostly hands-off</Badge>}
                  {task.is_custom && <Badge variant="muted">Yours</Badge>}
                </div>
                {task.description && <p className="mt-1 text-sm">{task.description}</p>}
                {task.usedIn && (
                  <p className="mt-1 text-xs text-muted-foreground">Used in: {task.usedIn}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${task.title} up`}
                  disabled={!online || pending || index === 0}
                  onClick={() => move(task, "up")}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${task.title} down`}
                  disabled={!online || pending || index === tasks.length - 1}
                  onClick={() => move(task, "down")}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${task.title}`}
                  disabled={!online}
                  onClick={() => setEditing(task)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${task.title}`}
                  disabled={!online || pending}
                  onClick={() => remove(task)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="outline" disabled={!online} onClick={() => setEditing("new")}>
          <Plus aria-hidden /> Add prep task
        </Button>
        <OfflineNote what="edit the plan" />
      </div>

      {editing && (
        <TaskDialog
          key={editing === "new" ? "new" : editing.id}
          task={editing === "new" ? null : editing}
          weekStart={weekStart}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function TaskDialog({
  task,
  weekStart,
  onClose,
}: {
  task: PrepTaskView | null;
  weekStart: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [minutes, setMinutes] = useState(String(task?.minutes ?? 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const value = Number.parseInt(minutes, 10);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter the minutes as a whole number.");
      return;
    }
    setError(null);
    start(async () => {
      const fields = { title, description: description || null, minutes: value };
      const saved = task
        ? unwrap(await editPrepTask({ id: task.id, ...fields }), "Task updated")
        : unwrap(await addPrepTask({ weekStart, ...fields }), "Task added");
      if (saved) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {task ? "Edit prep task" : "Add prep task"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t-title">Task</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Wash greens"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-desc">Details</Label>
            <Textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-min">Minutes</Label>
            <Input
              id="t-min"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
            <FieldError>{error}</FieldError>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || !title.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────── controls ───────────────────────────────

export function RegeneratePrepButton({
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
    <Button
      variant={variant}
      disabled={pending || !online}
      onClick={() =>
        start(async () => {
          const done = unwrap(await regeneratePrep({ weekStart }));
          if (!done) return;
          const { added, removed, changed, tasks, totalMinutes } = done.data;
          const parts = [
            added && `${added} added`,
            removed && `${removed} removed`,
            changed && `${changed} updated`,
          ].filter(Boolean);
          toast.success(
            parts.length
              ? `Prep plan updated — ${parts.join(", ")}`
              : `Prep plan is up to date — ${pluralize(tasks, "task")}, ${totalMinutes} min`,
          );
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden className={cn(pending && "animate-spin motion-reduce:animate-none")} />{" "}
      {label}
    </Button>
  );
}

export function PrepUpdateBanner({
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
        Your plan changed since this prep plan was made — {parts.join(", ")}. Your edits and
        progress will be kept.
      </p>
      <RegeneratePrepButton weekStart={weekStart} label="Update prep plan" variant="default" />
    </div>
  );
}

/** Move the session to another day (three days before the week through its last day). */
export function PrepDayPicker({
  weekStart,
  value,
  options,
}: {
  weekStart: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const online = useOnline();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="prep-day" className="text-sm text-muted-foreground">
        Prep on
      </Label>
      <div className="w-44">
        <NativeSelect
          id="prep-day"
          value={value}
          disabled={pending || !online}
          className="h-10 rounded-full"
          onChange={(e) =>
            start(async () => {
              unwrap(await changePrepDay({ weekStart, date: e.target.value }), "Prep day changed");
            })
          }
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
