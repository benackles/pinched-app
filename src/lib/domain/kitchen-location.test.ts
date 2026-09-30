import { describe, expect, it } from "vitest";

import { guessKitchenLocation, kitchenLocationFor } from "./kitchen-location";

describe("where things live", () => {
  it("puts dairy, eggs and meat in the fridge and frozen food in the freezer", () => {
    for (const name of [
      "milk",
      "eggs",
      "butter",
      "greek yogurt",
      "chicken thighs",
      "ground beef",
      "salmon",
    ]) {
      expect(guessKitchenLocation(name), name).toBe("fridge");
    }
    expect(guessKitchenLocation("frozen peas")).toBe("freezer");
  });

  it("keeps onions, garlic and potatoes out of the fridge, but not leafy greens", () => {
    for (const name of [
      "onion",
      "yellow onions",
      "garlic",
      "sweet potatoes",
      "russet potatoes",
      "shallots",
    ]) {
      expect(guessKitchenLocation(name), name).toBe("pantry");
    }
    for (const name of ["spinach", "broccoli", "cucumber", "lemons", "cilantro"]) {
      expect(guessKitchenLocation(name), name).toBe("fridge");
    }
  });

  it("leaves dry goods and anything unknown in the pantry", () => {
    for (const name of [
      "rice",
      "flour",
      "olive oil",
      "soy sauce",
      "kosher salt",
      "something odd",
    ]) {
      expect(guessKitchenLocation(name), name).toBe("pantry");
    }
  });

  it("works from a grocery section and an optional name", () => {
    expect(kitchenLocationFor("Produce")).toBe("fridge");
    expect(kitchenLocationFor("Produce", "red onion")).toBe("pantry");
    expect(kitchenLocationFor("Bakery")).toBe("pantry");
    expect(kitchenLocationFor("Other")).toBe("pantry");
  });
});
