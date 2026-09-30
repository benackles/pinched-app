import { describe, expect, it } from "vitest";

import {
  dinnerMessage,
  dueReminders,
  formatMinutes,
  inWindow,
  listTitles,
  localParts,
  parseReminderTime,
  prepMessage,
  validZone,
  type RecipientProfile,
} from "../../supabase/functions/_shared/reminders.ts";

const profile = (over: Partial<RecipientProfile> = {}): RecipientProfile => ({
  user_id: "user_a",
  timezone: "America/Los_Angeles",
  reminder_time: "17:00:00",
  remind_prep: true,
  remind_dinner: true,
  ...over,
});

describe("local time", () => {
  it("reads the date and minutes in the person's own zone", () => {
    // 00:05 UTC on the 5th is still the evening of the 4th in Los Angeles (PDT, UTC−7).
    expect(localParts(new Date("2026-10-05T00:05:00Z"), "America/Los_Angeles")).toEqual({
      date: "2026-10-04",
      minutes: 17 * 60 + 5,
    });
    expect(localParts(new Date("2026-10-05T00:05:00Z"), "UTC")).toEqual({
      date: "2026-10-05",
      minutes: 5,
    });
    // Ahead of UTC: already the next morning in Auckland (NZDT, UTC+13).
    expect(localParts(new Date("2026-10-31T12:30:00Z"), "Pacific/Auckland")).toEqual({
      date: "2026-11-01",
      minutes: 1 * 60 + 30,
    });
  });

  it("never reports hour 24 at midnight", () => {
    expect(localParts(new Date("2026-10-05T07:00:00Z"), "America/Los_Angeles")).toEqual({
      date: "2026-10-05",
      minutes: 0,
    });
  });

  it("follows daylight saving changes", () => {
    // US clocks go back on 1 Nov 2026: 17:00 local is 00:00 UTC the next day before, 01:00 UTC after.
    expect(localParts(new Date("2026-11-01T23:30:00Z"), "America/Los_Angeles").minutes).toBe(
      15 * 60 + 30,
    );
    expect(localParts(new Date("2026-11-02T01:00:00Z"), "America/Los_Angeles").minutes).toBe(
      17 * 60,
    );
  });

  it("validates zones", () => {
    expect(validZone("Europe/London")).toBe("Europe/London");
    expect(validZone("Mars/Olympus")).toBeNull();
    expect(validZone("")).toBeNull();
    expect(validZone(null)).toBeNull();
  });
});

describe("reminder time", () => {
  it("parses Postgres time values", () => {
    expect(parseReminderTime("17:00:00")).toBe(1020);
    expect(parseReminderTime("07:30")).toBe(450);
    expect(parseReminderTime("00:00:00")).toBe(0);
    expect(parseReminderTime("23:59:59")).toBe(23 * 60 + 59);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "5pm", "24:00:00", "17:60:00", "17", "17:00:00:00", "ab:cd"]) {
      expect(parseReminderTime(bad), bad).toBeNull();
    }
  });
  it("is due from the chosen minute until the window closes — never before, never past midnight", () => {
    expect(inWindow(1019, 1020, 60)).toBe(false);
    expect(inWindow(1020, 1020, 60)).toBe(true);
    expect(inWindow(1079, 1020, 60)).toBe(true);
    expect(inWindow(1080, 1020, 60)).toBe(false);
    // 23:30 with a 60-minute window ends at midnight, not at 00:30 the next day.
    expect(inWindow(23 * 60 + 59, 23 * 60 + 30, 60)).toBe(true);
    expect(inWindow(0, 23 * 60 + 30, 60)).toBe(false);
  });
});

describe("dueReminders", () => {
  it("is due inside the window, in the person's zone, with that zone's date", () => {
    const due = dueReminders(profile(), new Date("2026-10-05T00:05:00Z")); // 17:05 on the 4th in LA
    expect(due).toEqual({ localDate: "2026-10-04", kinds: ["prep_day", "tonights_dinner"] });
  });

  it("is not due before the time or after the window", () => {
    expect(dueReminders(profile(), new Date("2026-10-04T23:59:00Z"))).toBeNull(); // 16:59
    expect(dueReminders(profile(), new Date("2026-10-05T01:00:00Z"))).toBeNull(); // 18:00
  });

  it("respects which reminders are on", () => {
    const now = new Date("2026-10-05T00:05:00Z");
    expect(dueReminders(profile({ remind_dinner: false }), now)?.kinds).toEqual(["prep_day"]);
    expect(dueReminders(profile({ remind_prep: false }), now)?.kinds).toEqual(["tonights_dinner"]);
    expect(dueReminders(profile({ remind_prep: false, remind_dinner: false }), now)).toBeNull();
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    const now = new Date("2026-10-05T17:05:00Z");
    expect(dueReminders(profile({ timezone: null }), now)?.localDate).toBe("2026-10-05");
    expect(dueReminders(profile({ timezone: "Nowhere/Land" }), now)?.localDate).toBe("2026-10-05");
  });

  it("ignores a malformed time rather than guessing", () => {
    expect(
      dueReminders(profile({ reminder_time: "later" }), new Date("2026-10-05T00:05:00Z")),
    ).toBeNull();
  });

  it("lands on each person's own moment for the same instant", () => {
    const instant = new Date("2026-10-05T14:05:00Z");
    // 07:05 in LA, 10:05 in New York, 15:05 in London, 23:05 in Tokyo
    const at = (timezone: string, reminder_time: string) =>
      dueReminders(profile({ timezone, reminder_time }), instant) !== null;
    expect(at("America/Los_Angeles", "07:00")).toBe(true);
    expect(at("America/New_York", "07:00")).toBe(false);
    expect(at("America/New_York", "10:00")).toBe(true);
    expect(at("Europe/London", "15:00")).toBe(true);
    expect(at("Asia/Tokyo", "23:00")).toBe(true);
  });
});

describe("wording", () => {
  it("formats durations", () => {
    expect(formatMinutes(25)).toBe("25 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(65)).toBe("1 hr 5 min");
    expect(formatMinutes(150)).toBe("2 hr 30 min");
  });

  it("lists titles", () => {
    expect(listTitles(["A"])).toBe("A");
    expect(listTitles(["A", "B"])).toBe("A and B");
    expect(listTitles(["A", "B", "C"])).toBe("A, B and 1 more");
    expect(listTitles(["A", "B", "C", "D"])).toBe("A, B and 2 more");
  });

  it("says what prep day holds and opens the prep plan", () => {
    expect(prepMessage({ taskCount: 5, minutes: 75 })).toEqual({
      title: "It's prep day",
      body: "5 tasks to get ahead of the week — about 1 hr 15 min. Tap to start.",
      url: "/prep",
      tag: "prep-day",
    });
    expect(prepMessage({ taskCount: 1, minutes: 0 }).body).toBe(
      "1 task to get ahead of the week. Tap to start.",
    );
  });

  it("names tonight's dinner, and goes straight to cooking when there is one", () => {
    expect(dinnerMessage([])).toBeNull();
    expect(dinnerMessage([{ id: "m1", title: "Chicken Rice Bowls" }])).toEqual({
      title: "Tonight's dinner",
      body: "Chicken Rice Bowls",
      url: "/cook/m1",
      tag: "tonights-dinner",
    });
    const two = dinnerMessage([
      { id: "m1", title: "Soup" },
      { id: "m2", title: "Bread" },
    ]);
    expect(two?.body).toBe("Soup and Bread");
    expect(two?.url).toBe("/plan");
  });
});
