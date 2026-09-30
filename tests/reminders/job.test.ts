/**
 * The reminder job against a real Postgres (PGlite, every real migration) through supabase-js,
 * with the push sender replaced by a recorder. Times are fixed so each person's window is exact.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  runReminders,
  type Sender,
  type SendResult,
} from "../../supabase/functions/send-reminders/core.ts";
import type { PushMessage } from "../../supabase/functions/_shared/reminders.ts";
import { serviceClient } from "../support/admin";
import { asAnon, asService, asUser, createTestDb, pgError, type Db } from "../support/db";

// Monday 5 Oct 2026, 00:05 UTC — which is 17:05 on Sunday 4 Oct in Los Angeles (PDT).
const NOW = new Date("2026-10-05T00:05:00Z");

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KEYS = `'{"p256dh":"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM","auth":"tBHItJI5svbpez7KI4CCXg"}'::jsonb`;

let db: Db;

type Call = { endpoint: string; message: PushMessage };
const calls: Call[] = [];
let behave: (endpoint: string) => SendResult = () => ({ ok: true });
const send: Sender = async (target, message) => {
  calls.push({ endpoint: target.endpoint, message });
  return behave(target.endpoint);
};
const run = (now = NOW) => runReminders({ admin: serviceClient(db), send, now });

const sql = (statement: string) => asService(db, (tx) => tx.exec(statement));
const query = async <T>(statement: string) =>
  (await asService(db, (tx) => tx.query<T>(statement))).rows;

/** A person with profile, optional Pro subscription and devices. */
async function person(
  user: string,
  options: {
    timezone?: string;
    time?: string;
    prep?: boolean;
    dinner?: boolean;
    sub?: "active" | "canceled" | "trialing" | "past_due" | null;
    devices?: number;
  } = {},
) {
  const {
    timezone = "UTC",
    time = "00:00",
    prep = true,
    dinner = true,
    sub = "active",
    devices = 1,
  } = options;
  await sql(`insert into profiles (user_id, email, timezone, reminder_time, remind_prep, remind_dinner)
             values ('${user}', '${user}@example.test', '${timezone}', '${time}', ${prep}, ${dinner})`);
  if (sub) {
    await sql(`insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end)
               values ('${user}', 'sub_${user}', 'cus_${user}', '${sub}', now() + interval '20 days')`);
  }
  for (let i = 0; i < devices; i++) {
    await sql(`insert into push_subscriptions (user_id, endpoint, keys)
               values ('${user}', 'https://push.test/${user}/${i}', ${KEYS})`);
  }
}

/** A recipe in the person's book, planned as a meal on a date. */
async function plan(
  user: string,
  n: number,
  date: string,
  weekStart: string,
  title: string,
  mealType = "dinner",
) {
  const recipe = uid(n * 10 + 1);
  const saved = uid(n * 10 + 2);
  const week = uid(n * 10 + 3);
  await sql(`
    insert into recipes (id, source, title, owner_id) values ('${recipe}', 'manual', '${title}', '${user}');
    insert into saved_recipes (id, user_id, recipe_id) values ('${saved}', '${user}', '${recipe}');
    insert into weekly_plans (id, user_id, week_start_date) values ('${week}', '${user}', '${weekStart}')
      on conflict (user_id, week_start_date) do nothing;
  `);
  const weekId = (
    await query<{ id: string }>(
      `select id from weekly_plans where user_id = '${user}' and week_start_date = '${weekStart}'`,
    )
  )[0]!.id;
  await sql(`insert into planned_meals (id, user_id, weekly_plan_id, saved_recipe_id, planned_date, meal_type, servings)
             values ('${uid(n * 10 + 4)}', '${user}', '${weekId}', '${saved}', '${date}', '${mealType}', 2)`);
  return { meal: uid(n * 10 + 4), saved, week: weekId };
}

async function prepPlan(
  user: string,
  weekId: string,
  n: number,
  date: string,
  tasks: [string, number, { done?: boolean; removed?: boolean }?][],
) {
  const planId = uid(n * 10 + 5);
  await sql(
    `insert into prep_plans (id, user_id, weekly_plan_id, prep_date) values ('${planId}', '${user}', '${weekId}', '${date}')`,
  );
  for (const [title, minutes, flags] of tasks) {
    await sql(`insert into prep_tasks (user_id, prep_plan_id, title, minutes, is_completed, is_removed)
               values ('${user}', '${planId}', '${title}', ${minutes}, ${flags?.done ?? false}, ${flags?.removed ?? false})`);
  }
}

const deliveries = () =>
  query<{ user_id: string; kind: string; local_date: string }>(
    "select user_id, kind, local_date::text from push_deliveries order by user_id, kind",
  );
const to = (user: string) => calls.filter((c) => c.endpoint.includes(`/${user}/`));

beforeAll(async () => {
  db = await createTestDb();

  // Who is in the running.
  await person("u_utc"); // due now: prep day + dinner
  await person("u_la", { timezone: "America/Los_Angeles", time: "17:00", devices: 2 });
  await person("u_ver", { prep: false }); // dinner only; has a personal version title
  await person("u_later", { time: "08:00" }); // not due yet
  await person("u_free", { sub: null }); // Free: no reminders
  await person("u_expired", { sub: "canceled" });
  await person("u_off", { prep: false, dinner: false });
  await person("u_nodevice", { devices: 0 });
  await person("u_trial", { sub: "trialing", timezone: "Asia/Tokyo", time: "09:00" }); // 09:05 in Tokyo

  // u_utc: prep day today (Mon 5 Oct) and a dinner; a lunch must be ignored.
  const utc = await plan("u_utc", 1, "2026-10-05", "2026-10-05", "Lentil Soup");
  await plan("u_utc", 2, "2026-10-05", "2026-10-05", "Toast", "lunch");
  await prepPlan("u_utc", utc.week, 1, "2026-10-05", [
    ["Dice onions", 20],
    ["Cook rice", 30],
    ["Done already", 10, { done: true }],
    ["Deleted", 15, { removed: true }],
  ]);

  // u_la: two dinners on Sunday 4 Oct (local), no prep plan that day.
  await plan("u_la", 3, "2026-10-04", "2026-09-28", "Tacos");
  await plan("u_la", 4, "2026-10-04", "2026-09-28", "Rice");

  // u_ver: one dinner, titled by their own version.
  const ver = await plan("u_ver", 5, "2026-10-05", "2026-10-05", "Original Name");
  await sql(`insert into recipe_modifications (user_id, saved_recipe_id, changes)
             values ('u_ver', '${ver.saved}', '{"title":"My Better Name"}')`);

  // Everyone else has a dinner planned too, so only the rules keep them out.
  for (const [i, user] of ["u_later", "u_free", "u_expired", "u_off", "u_nodevice"].entries()) {
    await plan(user, 10 + i, "2026-10-05", "2026-10-05", `Dinner for ${user}`);
  }
  await plan("u_trial", 20, "2026-10-05", "2026-10-05", "Ramen"); // Tokyo's local date is the 5th
});

afterAll(async () => {
  await db.close();
});

describe("send-reminders", () => {
  it("considers only Pro people who opted in and have a device", async () => {
    const summary = await run(new Date("2026-10-04T12:00:00Z")); // nobody's window
    expect(summary).toMatchObject({ recipients: 5, due: 0, sent: 0 });
    // u_utc, u_la, u_ver, u_later, u_trial — not free, expired, off, or device-less
    expect(calls).toHaveLength(0);
  });

  it("sends the prep-day reminder with the task count and time, and dinner with the title", async () => {
    calls.length = 0;
    const summary = await run();
    expect(summary).toMatchObject({ failed: 0, retrying: 0, already: 0 });

    const prep = to("u_utc").find((c) => c.message.tag === "prep-day");
    expect(prep?.message).toEqual({
      title: "It's prep day",
      // 20 + 30 = 50 min across 2 tasks: the completed and the deleted task don't count
      body: "2 tasks to get ahead of the week — about 50 min. Tap to start.",
      url: "/prep",
      tag: "prep-day",
    });
    const dinner = to("u_utc").find((c) => c.message.tag === "tonights-dinner");
    expect(dinner?.message.body).toBe("Lentil Soup"); // the lunch is not mentioned
    expect(dinner?.message.url).toBe(`/cook/${uid(14)}`);
  });

  it("uses the person's own zone: same instant, different local day", async () => {
    const la = to("u_la");
    // 17:05 on Sunday in LA. Two dinners → a list that opens the week. No prep plan → no prep push.
    expect(la.filter((c) => c.message.tag === "tonights-dinner")).toHaveLength(2); // two devices
    expect(la[0]!.message.body).toBe("Tacos and Rice");
    expect(la[0]!.message.url).toBe("/plan");
    expect(la.some((c) => c.message.tag === "prep-day")).toBe(false);
    // Tokyo, 09:05 on the 5th: dinner planned for the 5th.
    expect(to("u_trial")[0]?.message.body).toBe("Ramen");
  });

  it("titles a meal the way the person sees it — their version wins", () => {
    expect(to("u_ver")).toHaveLength(1);
    expect(to("u_ver")[0]!.message.body).toBe("My Better Name");
  });

  it("leaves out everyone who isn't eligible or isn't due", () => {
    for (const user of ["u_later", "u_free", "u_expired", "u_off", "u_nodevice"]) {
      expect(to(user), user).toHaveLength(0);
    }
  });

  it("records one delivery per person, kind and local day", async () => {
    expect(await deliveries()).toEqual([
      { user_id: "u_la", kind: "tonights_dinner", local_date: "2026-10-04" },
      { user_id: "u_trial", kind: "tonights_dinner", local_date: "2026-10-05" },
      { user_id: "u_utc", kind: "prep_day", local_date: "2026-10-05" },
      { user_id: "u_utc", kind: "tonights_dinner", local_date: "2026-10-05" },
      { user_id: "u_ver", kind: "tonights_dinner", local_date: "2026-10-05" },
    ]);
  });

  it("never notifies twice for the same day, however often it runs", async () => {
    const before = calls.length;
    const again = await run(new Date(NOW.getTime() + 10 * 60_000));
    expect(again.sent).toBe(0);
    expect(again.already).toBeGreaterThan(0);
    expect(calls).toHaveLength(before);
  });

  it("says nothing when there is nothing to say — and doesn't use up the day's slot", async () => {
    // u_la has no prep plan today, so no prep push was sent and nothing was claimed…
    expect((await deliveries()).some((d) => d.user_id === "u_la" && d.kind === "prep_day")).toBe(
      false,
    );
    // …so a plan made later in the window is still reminded about.
    const la = await query<{ id: string }>("select id from weekly_plans where user_id = 'u_la'");
    await prepPlan("u_la", la[0]!.id, 6, "2026-10-04", [["Chop veg", 25]]);
    calls.length = 0;
    await run(new Date(NOW.getTime() + 20 * 60_000));
    const prep = to("u_la").filter((c) => c.message.tag === "prep-day");
    expect(prep).toHaveLength(2); // both devices
    expect(prep[0]!.message.body).toBe(
      "1 task to get ahead of the week — about 25 min. Tap to start.",
    );
  });

  it("stops once the person's window has closed", async () => {
    calls.length = 0;
    const late = await run(new Date("2026-10-05T03:00:00Z")); // 20:00 in LA, 03:00 UTC
    expect(late).toMatchObject({ due: 0, sent: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("send-reminders — failures", () => {
  it("forgets devices the push service says are gone", async () => {
    await sql("delete from push_deliveries where user_id = 'u_la'");
    calls.length = 0;
    behave = (endpoint) =>
      endpoint.endsWith("/u_la/1")
        ? { ok: false, gone: true, retryable: false, status: 410 }
        : { ok: true };
    const summary = await run();
    behave = () => ({ ok: true });
    expect(summary.removedDevices).toBeGreaterThan(0);
    const left = await query<{ endpoint: string }>(
      "select endpoint from push_subscriptions where user_id = 'u_la'",
    );
    expect(left.map((d) => d.endpoint)).toEqual(["https://push.test/u_la/0"]);
    // the other device still counted as delivered
    expect(summary.failed).toBe(0);
  });

  it("gives the slot back after a transient failure so the next run retries", async () => {
    await sql("delete from push_deliveries where user_id = 'u_utc'");
    calls.length = 0;
    behave = () => ({ ok: false, gone: false, retryable: true, status: 503 });
    const first = await run();
    expect(first.retrying).toBeGreaterThan(0);
    expect((await deliveries()).filter((d) => d.user_id === "u_utc")).toEqual([]);

    behave = () => ({ ok: true });
    calls.length = 0;
    const second = await run(new Date(NOW.getTime() + 10 * 60_000));
    expect(second.sent).toBeGreaterThan(0);
    expect(
      to("u_utc")
        .map((c) => c.message.tag)
        .sort(),
    ).toEqual(["prep-day", "tonights-dinner"]);
  });

  it("does not retry a permanent failure all day", async () => {
    await sql("delete from push_deliveries where user_id = 'u_ver'");
    behave = () => ({ ok: false, gone: false, retryable: false, status: 403 });
    const first = await run();
    expect(first.failed).toBeGreaterThan(0);
    expect((await deliveries()).some((d) => d.user_id === "u_ver")).toBe(true);
    calls.length = 0;
    behave = () => ({ ok: true });
    await run(new Date(NOW.getTime() + 10 * 60_000));
    expect(to("u_ver")).toHaveLength(0); // still claimed for today
  });

  it("one person's failure doesn't stop the others", async () => {
    await sql("delete from push_deliveries");
    calls.length = 0;
    behave = (endpoint) => {
      if (endpoint.includes("/u_utc/")) throw new Error("boom");
      return { ok: true };
    };
    const summary = await run();
    behave = () => ({ ok: true });
    expect(summary.failed).toBeGreaterThan(0);
    expect(to("u_la").length).toBeGreaterThan(0);
    expect(to("u_ver").length).toBeGreaterThan(0);
  });
});

describe("reminder_recipients() is service-only", () => {
  it("cannot be called by a signed-in user or an anonymous caller", async () => {
    const user = await pgError(() =>
      asUser(db, "u_utc", (tx) => tx.query("select * from public.reminder_recipients()")),
    );
    expect(user?.code).toBe("42501");
    const anon = await pgError(() =>
      asAnon(db, (tx) => tx.query("select * from public.reminder_recipients()")),
    );
    expect(anon?.code).toBe("42501");
  });
});
