import { describe, expect, it } from "vitest";

import { buildIngredient } from "./ingredients";
import { parseLooseNumber, parseQuickAdd, parseQuickAddLines } from "./quick-add";
import { applyModification } from "./recipe-modification";
import { isScalable, parseYield, scaleFactor, scaleQuantity } from "./scaling";
import { meal, recipe } from "./test-helpers";
import {
  addDays,
  currentWeekStart,
  dayName,
  daysBetween,
  isISODate,
  isMonday,
  isoWeekday,
  longDate,
  mondayOf,
  monthKey,
  prepDateFor,
  prepDateOptions,
  shiftWeek,
  shortDate,
  shortDay,
  todayInZone,
  weekDays,
  weekRangeLabel,
} from "./week";
import { generateGrocery } from "./grocery";

describe("week helpers", () => {
  it("validates real calendar dates only", () => {
    expect(isISODate("2026-09-28")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("2026-9-28")).toBe(false);
    expect(isISODate("tomorrow")).toBe(false);
  });

  it("finds Monday for any day (Mon–Sun weeks)", () => {
    expect(mondayOf("2026-09-28")).toBe("2026-09-28"); // a Monday
    expect(mondayOf("2026-09-30")).toBe("2026-09-28"); // Wednesday
    expect(mondayOf("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the week that started the Monday before
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(isMonday("2026-09-28")).toBe(true);
    expect(isMonday("2026-09-29")).toBe(false);
    expect(isoWeekday("2026-10-04")).toBe(7);
  });

  it("builds the seven days and steps between weeks across month and year ends", () => {
    expect(weekDays("2026-09-28")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(shiftWeek("2026-09-28", 1)).toBe("2026-10-05");
    expect(shiftWeek("2026-09-28", -1)).toBe("2026-09-21");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(daysBetween("2026-09-28", "2026-10-04")).toBe(6);
  });

  it("formats names and ranges", () => {
    expect(dayName("2026-09-28")).toBe("Monday");
    expect(shortDay("2026-09-29")).toBe("Tue");
    expect(shortDate("2026-09-28")).toBe("Sep 28");
    expect(longDate("2026-09-28")).toBe("September 28, 2026");
    expect(weekRangeLabel("2026-09-28")).toBe("Sep 28 – Oct 4");
  });

  it("finds today in the person's own timezone, not the server's", () => {
    // 2026-10-01 03:30 UTC is still Sept 30 in Denver and already Oct 1 in Tokyo.
    const instant = new Date("2026-10-01T03:30:00Z");
    expect(todayInZone("America/Denver", instant)).toBe("2026-09-30");
    expect(todayInZone("Asia/Tokyo", instant)).toBe("2026-10-01");
    expect(todayInZone(null, instant)).toBe("2026-10-01");
    expect(todayInZone("Not/AZone", instant)).toBe("2026-10-01");
    expect(currentWeekStart("America/Denver", instant)).toBe("2026-09-28");
    expect(currentWeekStart("Asia/Tokyo", new Date("2026-10-04T16:00:00Z"))).toBe("2026-10-05"); // already Monday in Tokyo
    expect(monthKey("America/Denver", new Date("2026-10-01T03:30:00Z"))).toBe("2026-09");
  });

  it("puts the prep day before the week starts for Fri/Sat/Sun", () => {
    expect(prepDateFor("2026-09-28", 7)).toBe("2026-09-27"); // Sunday prep for the week ahead
    expect(prepDateFor("2026-09-28", 6)).toBe("2026-09-26");
    expect(prepDateFor("2026-09-28", 5)).toBe("2026-09-25");
    expect(prepDateFor("2026-09-28", 1)).toBe("2026-09-28");
    expect(prepDateFor("2026-09-28", 3)).toBe("2026-09-30");
    const options = prepDateOptions("2026-09-28");
    expect(options[0]).toBe("2026-09-25");
    expect(options).toHaveLength(10);
    expect(options).toContain("2026-09-27");
  });

  it("rejects malformed dates loudly", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("scaling", () => {
  it("scales by servings ÷ yield", () => {
    expect(scaleFactor(4, 2)).toBe(0.5);
    expect(scaleFactor(4, 6)).toBe(1.5);
    expect(scaleFactor(2, 2)).toBe(1);
    expect(scaleQuantity(3, 1.5)).toBe(4.5);
    expect(scaleQuantity(null, 2)).toBeNull();
  });

  it("does not scale when the yield is unknown or nonsense", () => {
    for (const bad of [null, undefined, 0, -2, Number.NaN]) {
      expect(scaleFactor(bad as number, 8)).toBe(1);
      expect(isScalable(bad as number)).toBe(false);
    }
    expect(scaleFactor(4, 0)).toBe(1);
  });

  it("reads recipe yields", () => {
    expect(parseYield("4 servings")).toEqual({ servings: 4, label: null });
    expect(parseYield("4")).toEqual({ servings: 4, label: null });
    expect(parseYield(6)).toEqual({ servings: 6, label: null });
    expect(parseYield("Makes 12 muffins")).toEqual({ servings: 12, label: "Makes 12 muffins" });
    expect(parseYield("4-6 servings")).toEqual({ servings: 4, label: "4-6 servings" });
    expect(parseYield("serves a crowd")).toEqual({ servings: null, label: "serves a crowd" });
    expect(parseYield(null)).toEqual({ servings: null, label: null });
    expect(parseYield("")).toEqual({ servings: null, label: null });
  });
});

describe("quick add", () => {
  it.each([
    ["2 onions", { name: "Onions", quantity: 2, unit: null, normalized_name: "onion" }],
    [
      "1 lb chicken thighs",
      { name: "Chicken thighs", quantity: 1, unit: "lb", normalized_name: "chicken thigh" },
    ],
    ["rice", { name: "Rice", quantity: null, unit: null, normalized_name: "rice" }],
    ["6 eggs", { name: "Eggs", quantity: 6, unit: null, normalized_name: "egg" }],
    [
      "1½ cups olive oil",
      { name: "Olive oil", quantity: 1.5, unit: "cup", normalized_name: "olive oil" },
    ],
    [
      "2 cans black beans",
      { name: "Black beans", quantity: 2, unit: "can", normalized_name: "black bean" },
    ],
    [
      "  Frozen peas  ",
      { name: "Frozen peas", quantity: null, unit: null, normalized_name: "frozen pea" },
    ],
  ])("%s", (input, expected) => {
    expect(parseQuickAdd(input)).toEqual(expected);
  });

  it("keeps the upper end of a range", () => {
    expect(parseQuickAdd("2-3 cloves garlic")).toMatchObject({ quantity: 3, unit: "clove" });
  });

  it("returns null for blank input and handles pasted lists", () => {
    expect(parseQuickAdd("   ")).toBeNull();
    expect(parseQuickAddLines("2 onions\n1 lb chicken thighs; rice\n\n")).toHaveLength(3);
  });

  it("parses lenient quantity entry", () => {
    expect(parseLooseNumber("1 1/2")).toBe(1.5);
    expect(parseLooseNumber("½")).toBe(0.5);
    expect(parseLooseNumber("1½")).toBe(1.5);
    expect(parseLooseNumber("3/4")).toBe(0.75);
    expect(parseLooseNumber("2.5")).toBe(2.5);
    expect(parseLooseNumber("")).toBeNull();
    expect(parseLooseNumber("abc")).toBeNull();
    expect(parseLooseNumber("-2")).toBeNull();
    expect(parseLooseNumber("1/0")).toBeNull();
  });
});

describe("personal versions", () => {
  const original = recipe(
    "Chili",
    4,
    ["2 tbsp chili powder", "1 lb ground beef"],
    ["Brown the beef.", "Add the chili powder."],
  );

  it("leaves the original untouched and falls back for anything unchanged", () => {
    const snapshot = JSON.stringify(original);
    const modified = applyModification(original, { title: "Mild chili" });
    expect(modified.title).toBe("Mild chili");
    expect(modified.ingredients).toBe(original.ingredients);
    expect(modified.servings).toBe(4);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(applyModification(original, null)).toBe(original);
  });

  it("replaces ingredients and steps, recomputing the merge key", () => {
    const modified = applyModification(original, {
      servings: 2,
      ingredients: [
        buildIngredient({ quantity: 1, unit: "tbsp", name: "Chili Powder" }),
        buildIngredient({ quantity: 1, unit: "lb", name: "ground turkey" }),
      ],
      steps: ["Brown the turkey."],
    });
    expect(modified.servings).toBe(2);
    expect(modified.ingredients.map((i) => i.normalized_name)).toEqual([
      "chili powder",
      "ground turkey",
    ]);
    expect(modified.ingredients.every((i) => i.id === null)).toBe(true);
    expect(modified.steps).toEqual([{ step_number: 1, instruction: "Brown the turkey." }]);
  });

  it("flows through to the grocery list: less chili in your version means less chili on your list", () => {
    const mild = applyModification(original, {
      ingredients: [
        buildIngredient({ quantity: 1, unit: "tbsp", name: "chili powder" }),
        buildIngredient({ quantity: 1, unit: "lb", name: "ground beef" }),
      ],
    });
    const items = generateGrocery([meal("m1", "2026-09-28", 4, mild)]);
    expect(items.find((i) => i.normalized_name === "chili powder")).toMatchObject({
      quantity: 1,
      unit: "tbsp",
    });
  });

  it("builds ingredients from form fields", () => {
    expect(
      buildIngredient({
        quantity: 1.5,
        unit: "cups",
        name: "Jasmine Rice",
        preparation: " rinsed ",
      }),
    ).toMatchObject({
      quantity: 1.5,
      unit: "cup",
      name: "jasmine rice",
      normalized_name: "rice",
      preparation: "rinsed",
      raw_text: "1½ cups jasmine rice, rinsed",
      grocery_section: "Pantry",
    });
    expect(buildIngredient({ name: "salt" })).toMatchObject({ quantity: null, raw_text: "Salt" });
  });
});
