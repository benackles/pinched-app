/**
 * The PRD's acceptance flow, end to end, in a real browser against the real app:
 *   sign up → import a URL + save seeded recipes → kitchen quick add → plan four meals (change
 *   servings, move one) → grocery list (owned excluded, merged, aisles) → custom item + offline
 *   check-offs that sync → consolidated prep plan → edit/reorder/complete, and regeneration keeps
 *   those edits → cook, rate, history.
 * (Stripe Checkout and the billing portal need real Stripe keys; the Pro gates are in billing.spec.ts.)
 */
import {
  aisles,
  addMealOnDay,
  alreadyHave,
  daySection,
  mealCard,
  RECIPES,
  saveCatalogRecipe,
  signIn,
  watchForErrors,
} from "./support/app";
import { HEADNOTE } from "./support/recipe-site";
import { expect, test } from "./support/test";

test("the whole week: recipes → kitchen → plan → grocery → prep → cook", async ({
  page,
  context,
  recipeSite,
}) => {
  test.setTimeout(300_000);
  const errors = watchForErrors(page);

  await test.step("1 · a new person lands on their (empty) week", async () => {
    await signIn(page, "acceptance");
    await expect(page.getByText("Nothing planned.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate Grocery List" })).toBeDisabled();
  });

  await test.step("2 · save seeded recipes and import one from a URL", async () => {
    for (const title of Object.values(RECIPES)) await saveCatalogRecipe(page, title);

    await page.goto("/recipes");
    await page.getByRole("button", { name: "Import from URL" }).click();
    await page.fill("#import-url", recipeSite.url);
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator("#r-title")).toHaveValue("Best Lentil Soup");
    await expect(page.locator("#r-author")).toHaveValue("Sam Cook");
    // Ingredients and steps come across; the site's own prose does not.
    await expect(page.locator("body")).not.toContainText(HEADNOTE);
    await page.getByRole("button", { name: "Save to my recipes" }).click();
    await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Best Lentil Soup" })).toBeVisible();
    await expect(page.getByText("Recipe by Sam Cook")).toBeVisible();
    await expect(page.getByRole("link", { name: "View the original" })).toBeVisible();
    await expect(page.getByText("1 cup red lentils")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(HEADNOTE);
  });

  await test.step("3 · kitchen quick add understands quantities", async () => {
    await page.goto("/kitchen");
    const add = page.getByLabel("Add a kitchen item");
    const lines = ["6 onions", "rice", "1 lb chicken thighs"];
    for (const [index, line] of lines.entries()) {
      await add.fill(line);
      await add.press("Enter");
      await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(index + 1);
    }
    await expect(page.getByText("6 Onions")).toBeVisible();
    await expect(page.getByText("1 lb Chicken thighs")).toBeVisible();
  });

  await test.step("4 · plan four meals, change servings, move one", async () => {
    await addMealOnDay(page, 1, RECIPES.bowls); // Tue
    await addMealOnDay(page, 2, RECIPES.patties); // Wed
    await addMealOnDay(page, 3, RECIPES.sheetPan); // Thu
    await addMealOnDay(page, 4, RECIPES.curry); // Fri

    await expect(page.getByText("4", { exact: true }).first()).toBeVisible(); // "4 meals planned" tile

    const card = mealCard(page, RECIPES.bowls);
    await expect(card.locator("span[aria-live=polite]")).toHaveText("4");
    await page.getByRole("button", { name: `More servings of ${RECIPES.bowls}` }).click();
    await expect(card.locator("span[aria-live=polite]")).toHaveText("5");

    await page.getByRole("button", { name: `Options for ${RECIPES.curry}` }).click();
    await page.getByRole("menuitem", { name: /Saturday/ }).click();
    await expect(daySection(page, "Saturday")).toContainText(RECIPES.curry);
    await expect(daySection(page, "Friday")).not.toContainText(RECIPES.curry);

    // The change stuck on the server, not just on screen.
    await page.reload();
    await expect(mealCard(page, RECIPES.bowls).locator("span[aria-live=polite]")).toHaveText("5");
    await expect(daySection(page, "Saturday")).toContainText(RECIPES.curry);
  });

  await test.step("5 · the grocery list: owned items excluded, duplicates merged, sorted into aisles", async () => {
    await page.getByRole("button", { name: "Generate Grocery List" }).click();
    await page.waitForURL("**/grocery-list");
    await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();

    const list = await aisles(page);
    expect(Object.keys(list)).toEqual(
      expect.arrayContaining(["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry"]),
    );

    // Already in the kitchen → not on the list, and shown under "Already have".
    const everything = Object.values(list).flat();
    expect(everything).not.toContain("yellow onions"); // 6 in stock covers every recipe
    expect(everything).not.toContain("jasmine rice"); // "rice" with no amount: assumed to be enough
    expect(await alreadyHave(page)).toEqual(
      expect.arrayContaining(["yellow onions", "jasmine rice"]),
    );
    // Matching is conservative: "chicken thighs" in the kitchen doesn't stand in for
    // "boneless skinless chicken thighs", so nothing is silently dropped from the list.
    expect(everything).toContain("boneless skinless chicken thighs");
    // A different ingredient with a similar name is still needed.
    expect(everything).toContain("red onion");

    // The same ingredient across recipes appears once, with one combined quantity.
    expect(new Set(everything).size).toBe(everything.length);
    const garlic = page.getByRole("button", { name: /^Edit garlic$/ });
    await expect(garlic).toHaveCount(1);
    await expect(garlic.locator("xpath=ancestor::li[1]")).toContainText(/For .*,/); // two or more recipes

    // …and every row says which meals it is for (nothing is orphaned from the plan).
    const rows = page.locator("section[aria-labelledby^='aisle-'] li");
    for (const row of await rows.all()) await expect(row).toContainText(/For /);
  });

  await test.step("6 · a custom item, then check-offs made offline that sync when the signal returns", async () => {
    await page.getByLabel("Add your own grocery item").fill("2 limes");
    await page.getByRole("button", { name: "Add item" }).click();
    const limes = page.getByRole("button", { name: /^Edit .*limes?/i });
    await expect(limes).toBeVisible();
    await expect(limes.locator("xpath=ancestor::li[1]")).toContainText("Added by you");

    await context.setOffline(true);
    await expect(page.getByText("You're offline. You can still check items off")).toBeVisible();
    const boxes = page.getByRole("checkbox");
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await expect(page.getByRole("status").filter({ hasText: "2 to sync" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Synced 2 offline changes")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  });

  let firstTask = "";
  await test.step("7 · the prep plan combines the work across recipes", async () => {
    await page.goto("/plan");
    await page.getByRole("button", { name: "Create Prep Plan" }).click();
    await page.waitForURL("**/prep");
    await expect(page.getByText(/Used in:/).first()).toBeVisible();

    // One task serving several recipes: chopping garlic once, not four times.
    const shared = page.locator("ol li", { hasText: /Used in: .*\(.*\).*\(.*\)/ });
    expect(await shared.count()).toBeGreaterThan(0);
    await expect(page.getByText(/min saved vs\. prepping each recipe on its own/)).toBeVisible();
    firstTask = (await page
      .getByRole("checkbox", { name: /^Complete / })
      .first()
      .getAttribute("aria-label"))!.replace(/^Complete /, "");
  });

  await test.step("8 · edit, reorder and complete tasks", async () => {
    const tasks = page.getByRole("checkbox", { name: /^(Complete|Undo) / });
    const before = await tasks.count();
    expect(before).toBeGreaterThan(5);

    // reorder
    await page.getByRole("button", { name: `Move ${firstTask} down` }).click();
    await expect(tasks.nth(1)).toHaveAttribute("aria-label", `Complete ${firstTask}`);

    // complete
    await tasks.nth(1).click();
    await expect(page.getByRole("checkbox", { name: `Undo ${firstTask}` })).toBeChecked();
    await expect(page.getByRole("progressbar", { name: "Prep progress" })).not.toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    // edit
    await page.getByRole("button", { name: `Edit ${firstTask}` }).click();
    await page.fill("#t-title", "My custom prep title");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("checkbox", { name: /My custom prep title/ })).toBeVisible();

    // all of it survives a reload
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Undo My custom prep title" })).toBeChecked();
    expect(await tasks.count()).toBe(before);
  });

  await test.step("9 · changing the plan updates the outputs without losing the person's edits", async () => {
    // Add a meal, regenerate both outputs.
    await addMealOnDay(page, 0, "Best Lentil Soup"); // Monday
    await page.goto("/prep");
    await expect(
      page.getByText(/Your plan changed|out of date|changed since/i).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Update prep plan|Update/ })
      .first()
      .click();
    await expect(page.getByText(/Prep plan updated/)).toBeVisible();
    // The edited title and the completed state are still there…
    await expect(page.getByRole("checkbox", { name: "Undo My custom prep title" })).toBeChecked();
    // …and the new meal is reflected.
    await expect(page.locator("ol").getByText("Best Lentil Soup").first()).toBeVisible();

    await page.goto("/grocery-list");
    await page
      .getByRole("button", { name: /Update/ })
      .first()
      .click();
    await expect(page.getByText(/List updated/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit .*limes?/i })).toBeVisible(); // custom item kept
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2); // check-offs kept
    await expect(page.getByRole("button", { name: /^Edit .*lentils/i })).toBeVisible(); // new meal's ingredient
  });

  await test.step("10 · cook it, rate it, see it in the history", async () => {
    await page.goto("/plan");
    await page.getByRole("button", { name: `Options for ${RECIPES.patties}` }).click();
    await page.getByRole("menuitem", { name: "Cook this" }).click();
    await page.waitForURL(/\/cook\//);
    await expect(page.getByRole("heading", { name: "Ingredients" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instructions" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Prep already done|Prep/ }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Mark as cooked" }).click();
    await page.getByRole("radio", { name: "5 stars" }).click();
    await page.fill("#cooked-note", "Great with extra yogurt sauce.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Logged to your cooking history")).toBeVisible();

    // The kitchen is never changed on its own: a suggestion, which can be skipped.
    const skip = page.getByRole("button", { name: "Skip" });
    if (await skip.isVisible().catch(() => false)) await skip.click();

    await page.goto("/recipes");
    await page
      .getByRole("link", { name: new RegExp(RECIPES.patties) })
      .first()
      .click();
    await page.getByRole("tab", { name: /^History/ }).click();
    await expect(page.getByText("Great with extra yogurt sauce.")).toBeVisible();
  });

  // The whole flow ran without an uncaught error or a console error.
  console.log("browser errors:", errors);
  expect(errors).toEqual([]);
});
