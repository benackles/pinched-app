import { describe, expect, it } from "vitest";

import {
  canonicalUnit,
  compatibleUnits,
  formatQuantity,
  friendly,
  fromBase,
  pickMeasured,
  toBase,
  unitKey,
  unitKind,
  unitLabel,
} from "./units";

describe("canonicalUnit", () => {
  it.each([
    ["cups", "cup"],
    ["Tablespoons", "tbsp"],
    ["tsp.", "tsp"],
    ["pounds", "lb"],
    ["lbs", "lb"],
    ["ounce", "oz"],
    ["fluid ounces", "fl oz"],
    ["kilograms", "kg"],
    ["cloves", "clove"],
    ["bunches", "bunch"],
    ["slices", "slice"],
    ["pkg", "package"],
    ["14-oz cans", "14-oz can"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalUnit(input)).toBe(expected);
  });

  it("returns null for things that are not units", () => {
    expect(canonicalUnit("")).toBeNull();
    expect(canonicalUnit(null)).toBeNull();
    expect(canonicalUnit("large")).toBeNull();
    expect(canonicalUnit("zorp")).toBeNull();
  });
});

describe("unit families", () => {
  it("only lets measured units of the same kind combine", () => {
    expect(compatibleUnits("cup", "tbsp")).toBe(true);
    expect(compatibleUnits("lb", "oz")).toBe(true);
    expect(compatibleUnits("g", "lb")).toBe(true);
    expect(compatibleUnits("cup", "lb")).toBe(false); // no density guessing
    expect(compatibleUnits(null, null)).toBe(true);
    expect(compatibleUnits(null, "cup")).toBe(false);
  });

  it("keeps every named unit to itself: 2 cups spinach ≠ 1 bag spinach", () => {
    expect(compatibleUnits("bag", "cup")).toBe(false);
    expect(compatibleUnits("clove", "head")).toBe(false);
    expect(compatibleUnits("clove", "clove")).toBe(true);
    expect(compatibleUnits("14-oz can", "28-oz can")).toBe(false);
  });

  it("classifies unit kinds and merge keys", () => {
    expect(unitKind(null)).toBe("each");
    expect(unitKind("tbsp")).toBe("volume");
    expect(unitKind("lb")).toBe("mass");
    expect(unitKind("bunch")).toBe("named");
    expect(unitKey("cup")).toBe(unitKey("tsp"));
    expect(unitKey("bunch")).toBe("u:bunch");
  });
});

describe("conversion", () => {
  it("round-trips through the base unit", () => {
    expect(fromBase(toBase(2, "cup"), "cup")).toBeCloseTo(2, 6);
    expect(fromBase(toBase(3, "tbsp"), "tsp")).toBeCloseTo(9, 2);
    expect(fromBase(toBase(1, "lb"), "oz")).toBeCloseTo(16, 2);
  });
});

describe("friendly + formatQuantity", () => {
  it("snaps to kitchen fractions", () => {
    expect(friendly(0.33)).toBeCloseTo(1 / 3);
    expect(friendly(1.5)).toBe(1.5);
    expect(friendly(0.6)).toBe(0.625); // 5/8
    expect(friendly(2.37)).toBeNull(); // eighths only below 2
    expect(friendly(2.3)).toBeNull();
    expect(friendly(14.4)).toBeNull(); // no 14⅜ of anything
    expect(friendly(12.5)).toBe(12.5);
  });

  it.each([
    [3.5, "3½"],
    [0.25, "¼"],
    [0.33, "⅓"],
    [0.67, "⅔"],
    [2, "2"],
    [2.001, "2"],
    [1.999, "2"],
    [0.125, "⅛"],
    [1.75, "1¾"],
    [2.37, "2⅜"],
    [2.3, "2.3"],
    [12, "12"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatQuantity(value)).toBe(expected);
  });

  it("returns empty for missing numbers", () => {
    expect(formatQuantity(null)).toBe("");
    expect(formatQuantity(undefined)).toBe("");
  });
});

describe("pickMeasured", () => {
  it("prefers the largest friendly unit", () => {
    expect(pickMeasured(toBase(6, "tbsp"), "volume", ["tbsp"])).toEqual({
      quantity: 6,
      unit: "tbsp",
    }); // never ⅜ cup
    expect(pickMeasured(toBase(8, "tbsp"), "volume", ["tbsp", "cup"])).toEqual({
      quantity: 0.5,
      unit: "cup",
    });
    expect(pickMeasured(toBase(4, "tbsp"), "volume", ["tbsp"])).toEqual({
      quantity: 0.25,
      unit: "cup",
    });
    expect(pickMeasured(toBase(2, "tbsp"), "volume", ["tbsp"])).toEqual({
      quantity: 2,
      unit: "tbsp",
    });
    expect(pickMeasured(toBase(1.5, "cup"), "volume", ["cup"])).toEqual({
      quantity: 1.5,
      unit: "cup",
    });
  });

  it("combines mixed units without inventing unfamiliar ones", () => {
    // 2 tbsp + ¼ cup = 6 tbsp
    const total = toBase(2, "tbsp") + toBase(0.25, "cup");
    expect(pickMeasured(total, "volume", ["tbsp", "cup"])).toEqual({ quantity: 6, unit: "tbsp" });
  });

  it("handles mass in either system", () => {
    expect(pickMeasured(toBase(1.5, "lb"), "mass", ["lb"])).toEqual({ quantity: 1.5, unit: "lb" });
    expect(pickMeasured(toBase(8, "oz"), "mass", ["oz", "lb"])).toEqual({
      quantity: 0.5,
      unit: "lb",
    });
    expect(pickMeasured(toBase(250, "g"), "mass", ["g"])).toEqual({ quantity: 250, unit: "g" });
    expect(pickMeasured(toBase(1500, "g"), "mass", ["g"])).toEqual({ quantity: 1.5, unit: "kg" });
  });

  it("falls back to a unit the recipes used when nothing is friendly", () => {
    const result = pickMeasured(toBase(0.3, "cup"), "volume", ["cup"]);
    expect(result.unit).toBe("cup");
    expect(result.quantity).toBeCloseTo(0.3, 2);
  });
});

describe("unitLabel", () => {
  it("pluralizes named units but not abbreviations", () => {
    expect(unitLabel("cup", 2)).toBe("cups");
    expect(unitLabel("cup", 1)).toBe("cup");
    expect(unitLabel("tbsp", 3)).toBe("tbsp");
    expect(unitLabel("bunch", 2)).toBe("bunches");
    expect(unitLabel("clove", 3)).toBe("cloves");
    expect(unitLabel("loaf", 2)).toBe("loaves");
    expect(unitLabel("14-oz can", 2)).toBe("14-oz cans");
    expect(unitLabel(null, 2)).toBe("");
  });
});
