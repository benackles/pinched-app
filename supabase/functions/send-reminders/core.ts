/**
 * The reminder job, with its I/O injected: a service-role Supabase client and a function that
 * sends one push. The Edge Function (index.ts) wires in the real ones; the tests wire in doubles.
 *
 * Guarantees:
 *  - opt-in and Pro only (the `reminder_recipients()` function decides who is considered)
 *  - at most one notification per person, kind and local day (`push_deliveries` primary key; the
 *    slot is claimed before sending, so overlapping runs can't both send)
 *  - nothing is sent when there is nothing to say (no prep plan today, no dinner planned)
 *  - devices that report "gone" are forgotten; a transient failure releases the slot so the next
 *    run retries, until the person's window closes
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_WINDOW_MINUTES,
  dinnerMessage,
  dueReminders,
  prepMessage,
  type PushMessage,
  type RecipientProfile,
  type ReminderKind,
} from "../_shared/reminders.ts";

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type SendResult =
  { ok: true } | { ok: false; gone: boolean; retryable: boolean; status?: number | undefined };
export type Sender = (target: PushTarget, message: PushMessage) => Promise<SendResult>;

export type Summary = {
  /** People with reminders on, Pro, and at least one device. */
  recipients: number;
  /** (person, reminder) pairs inside their time window. */
  due: number;
  /** Due, but nothing to say — no prep plan today, no dinner planned, no device. */
  quiet: number;
  /** Already sent for that local day. */
  already: number;
  sent: number;
  /** Failed for good (bad keys, rejected). */
  failed: number;
  /** Failed for now; the next run tries again. */
  retrying: number;
  /** Devices removed because the push service said they were gone. */
  removedDevices: number;
};

type Admin = SupabaseClient;
type Item = { profile: RecipientProfile; kind: ReminderKind; localDate: string };
type Device = { id: string; user_id: string; endpoint: string; keys: PushTarget["keys"] };

const BATCH = 100;
const CONCURRENCY = 8;

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

const unique = <T>(values: T[]) => [...new Set(values)];

function chunks<T>(values: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(workers);
}

// ─────────────────────────────── loading ───────────────────────────────

async function alreadySent(admin: Admin, items: Item[]): Promise<Set<string>> {
  const done = new Set<string>();
  const dates = unique(items.map((item) => item.localDate));
  for (const ids of chunks(unique(items.map((item) => item.profile.user_id)))) {
    const rows = check(
      await admin
        .from("push_deliveries")
        .select("user_id, kind, local_date")
        .in("user_id", ids)
        .in("local_date", dates),
      "load deliveries",
    ) as { user_id: string; kind: string; local_date: string }[];
    for (const row of rows) done.add(`${row.user_id}|${row.kind}|${row.local_date}`);
  }
  return done;
}

/** userId → what today's prep session holds, for people whose prep session is today. */
async function loadPrep(admin: Admin, items: Item[]) {
  const result = new Map<string, { taskCount: number; minutes: number }>();
  if (items.length === 0) return result;
  const wanted = new Set(items.map((item) => `${item.profile.user_id}|${item.localDate}`));
  const dates = unique(items.map((item) => item.localDate));

  const plans: { id: string; user_id: string }[] = [];
  for (const ids of chunks(unique(items.map((item) => item.profile.user_id)))) {
    const rows = check(
      await admin
        .from("prep_plans")
        .select("id, user_id, prep_date")
        .in("user_id", ids)
        .in("prep_date", dates),
      "load prep plans",
    ) as { id: string; user_id: string; prep_date: string }[];
    for (const row of rows) {
      if (wanted.has(`${row.user_id}|${row.prep_date}`)) plans.push(row);
    }
  }
  const owner = new Map(plans.map((plan) => [plan.id, plan.user_id]));

  for (const planIds of chunks(plans.map((plan) => plan.id))) {
    const tasks = check(
      await admin
        .from("prep_tasks")
        .select("prep_plan_id, minutes, is_completed, is_removed")
        .in("prep_plan_id", planIds),
      "load prep tasks",
    ) as { prep_plan_id: string; minutes: number; is_completed: boolean; is_removed: boolean }[];
    for (const task of tasks) {
      if (task.is_removed || task.is_completed) continue;
      const user = owner.get(task.prep_plan_id);
      if (!user) continue;
      const entry = result.get(user) ?? { taskCount: 0, minutes: 0 };
      entry.taskCount += 1;
      entry.minutes += task.minutes;
      result.set(user, entry);
    }
  }
  return result;
}

/** userId → today's planned dinners, titled the way the person sees them (their version wins). */
async function loadDinners(admin: Admin, items: Item[]) {
  const result = new Map<string, { id: string; title: string }[]>();
  if (items.length === 0) return result;
  const wanted = new Set(items.map((item) => `${item.profile.user_id}|${item.localDate}`));
  const dates = unique(items.map((item) => item.localDate));

  const meals: { id: string; user_id: string; saved_recipe_id: string; sort_order: number }[] = [];
  for (const ids of chunks(unique(items.map((item) => item.profile.user_id)))) {
    const rows = check(
      await admin
        .from("planned_meals")
        .select("id, user_id, saved_recipe_id, planned_date, sort_order")
        .eq("meal_type", "dinner")
        .in("user_id", ids)
        .in("planned_date", dates),
      "load dinners",
    ) as {
      id: string;
      user_id: string;
      saved_recipe_id: string;
      planned_date: string;
      sort_order: number;
    }[];
    for (const row of rows) {
      if (wanted.has(`${row.user_id}|${row.planned_date}`)) meals.push(row);
    }
  }
  if (meals.length === 0) return result;

  const savedIds = unique(meals.map((meal) => meal.saved_recipe_id));
  const recipeOf = new Map<string, string>();
  const versionTitle = new Map<string, string>();
  for (const ids of chunks(savedIds)) {
    const saved = check(
      await admin.from("saved_recipes").select("id, recipe_id").in("id", ids),
      "load saved recipes",
    ) as { id: string; recipe_id: string }[];
    for (const row of saved) recipeOf.set(row.id, row.recipe_id);
    const versions = check(
      await admin
        .from("recipe_modifications")
        .select("saved_recipe_id, changes")
        .in("saved_recipe_id", ids),
      "load versions",
    ) as { saved_recipe_id: string; changes: { title?: unknown } | null }[];
    for (const row of versions) {
      const title = row.changes?.title;
      if (typeof title === "string" && title.trim())
        versionTitle.set(row.saved_recipe_id, title.trim());
    }
  }
  const titleOf = new Map<string, string>();
  for (const ids of chunks(unique([...recipeOf.values()]))) {
    const recipes = check(
      await admin.from("recipes").select("id, title").in("id", ids),
      "load recipes",
    ) as { id: string; title: string }[];
    for (const row of recipes) titleOf.set(row.id, row.title);
  }

  meals.sort((a, b) => a.sort_order - b.sort_order);
  for (const meal of meals) {
    const title =
      versionTitle.get(meal.saved_recipe_id) ??
      titleOf.get(recipeOf.get(meal.saved_recipe_id) ?? "");
    if (!title) continue;
    const list = result.get(meal.user_id) ?? [];
    list.push({ id: meal.id, title });
    result.set(meal.user_id, list);
  }
  return result;
}

async function loadDevices(admin: Admin, userIds: string[]) {
  const byUser = new Map<string, Device[]>();
  for (const ids of chunks(unique(userIds))) {
    const rows = check(
      await admin
        .from("push_subscriptions")
        .select("id, user_id, endpoint, keys")
        .in("user_id", ids),
      "load devices",
    ) as Device[];
    for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }
  return byUser;
}

// ─────────────────────────────── the job ───────────────────────────────

export async function runReminders(deps: {
  admin: Admin;
  send: Sender;
  now?: Date;
  windowMinutes?: number;
}): Promise<Summary> {
  const { admin, send } = deps;
  const now = deps.now ?? new Date();
  const windowMinutes = deps.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const summary: Summary = {
    recipients: 0,
    due: 0,
    quiet: 0,
    already: 0,
    sent: 0,
    failed: 0,
    retrying: 0,
    removedDevices: 0,
  };

  const recipients = check(
    await admin.rpc("reminder_recipients"),
    "load recipients",
  ) as RecipientProfile[];
  summary.recipients = recipients.length;

  const items: Item[] = [];
  for (const profile of recipients) {
    const due = dueReminders(profile, now, windowMinutes);
    if (!due) continue;
    for (const kind of due.kinds) items.push({ profile, kind, localDate: due.localDate });
  }
  summary.due = items.length;
  if (items.length === 0) return summary;

  const sent = await alreadySent(admin, items);
  const todo = items.filter((item) => {
    const done = sent.has(`${item.profile.user_id}|${item.kind}|${item.localDate}`);
    if (done) summary.already += 1;
    return !done;
  });
  if (todo.length === 0) return summary;

  const prep = await loadPrep(
    admin,
    todo.filter((item) => item.kind === "prep_day"),
  );
  const dinners = await loadDinners(
    admin,
    todo.filter((item) => item.kind === "tonights_dinner"),
  );
  const devices = await loadDevices(
    admin,
    todo.map((item) => item.profile.user_id),
  );

  await mapLimit(todo, CONCURRENCY, async (item) => {
    const userId = item.profile.user_id;
    try {
      const message =
        item.kind === "prep_day"
          ? prep.has(userId)
            ? prepMessage(prep.get(userId)!)
            : null
          : dinnerMessage(dinners.get(userId) ?? []);
      const targets = devices.get(userId) ?? [];
      if (!message || targets.length === 0) {
        summary.quiet += 1;
        return;
      }

      // Claim today's slot before sending: a concurrent or repeated run hits the primary key.
      const claim = await admin
        .from("push_deliveries")
        .insert({ user_id: userId, kind: item.kind, local_date: item.localDate });
      if (claim.error) {
        if (claim.error.code === "23505") {
          summary.already += 1;
          return;
        }
        throw new Error(`claim delivery: ${claim.error.message}`);
      }

      const results = await Promise.all(
        targets.map(async (device) => ({
          device,
          result: await send({ endpoint: device.endpoint, keys: device.keys }, message),
        })),
      );

      const gone = results.filter((r) => !r.result.ok && r.result.gone).map((r) => r.device.id);
      if (gone.length) {
        const removed = await admin.from("push_subscriptions").delete().in("id", gone);
        if (!removed.error) summary.removedDevices += gone.length;
      }

      if (results.some((r) => r.result.ok)) {
        summary.sent += 1;
      } else if (results.some((r) => !r.result.ok && r.result.retryable)) {
        // Nobody got it and it may work next time: give the slot back while the window is open.
        await admin
          .from("push_deliveries")
          .delete()
          .eq("user_id", userId)
          .eq("kind", item.kind)
          .eq("local_date", item.localDate);
        summary.retrying += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error(
        `reminder ${item.kind} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  });

  return summary;
}
