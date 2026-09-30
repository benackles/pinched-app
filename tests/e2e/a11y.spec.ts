/**
 * Accessibility: axe-core against every main screen, at phone and desktop size, including the
 * dialogs and menus. Serious and critical violations fail the test (WCAG 2.1 A/AA rules).
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { addMealOnDay, RECIPES, saveCatalogRecipe, signIn } from "./support/app";
import { expect, test } from "./support/test";

/**
 * `overlay`: a menu or dialog is open. Radix hides the rest of the page from assistive technology
 * while it is, and traps focus inside it (Tab cannot leave); axe sees the hidden page's focusable
 * elements but not the trap, and reports "aria-hidden-focus". That rule is skipped for overlays
 * only — everything else, including the overlay's own content, is still checked.
 */
async function scan(page: Page, name: string, options: { overlay?: boolean } = {}) {
  // The title streams in after the content on client-side navigations; wait for it so the audit
  // judges the finished page.
  await expect(page).toHaveTitle(/\S/);
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal"); // the development overlay, not our UI
  if (options.overlay) builder.disableRules(["aria-hidden-focus"]);
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    blocking.map(
      (violation) =>
        `${violation.id} [${violation.impact}] ×${violation.nodes.length}: ${violation.help} — ${violation.nodes
          .slice(0, 2)
          .map((node) => node.target.join(" "))
          .join(" | ")}`,
    ),
    `${name} has accessibility violations`,
  ).toEqual([]);
}

test("public pages", async ({ page }) => {
  await page.goto("/");
  await scan(page, "landing");
  await page.goto("/sign-in");
  await scan(page, "sign in");
  await page.goto("/~offline");
  await scan(page, "offline fallback");
});

test("every signed-in screen, with real content in it", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "a11y");
  await scan(page, "plan (empty)");
  // A pointer resting on the primary button is a real state: its hover colour must pass too.
  await page.getByRole("button", { name: /^Add Meal/ }).hover();
  await scan(page, "plan (primary button hovered)");

  for (const title of [RECIPES.bowls, RECIPES.patties]) await saveCatalogRecipe(page, title);
  await addMealOnDay(page, 1, RECIPES.bowls);
  await addMealOnDay(page, 2, RECIPES.patties);
  await scan(page, "plan");

  await test.step("dialogs and menus", async () => {
    await page
      .getByRole("button", { name: /Add meal to this day/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "add-meal dialog", { overlay: true });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: `Options for ${RECIPES.bowls}` }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await scan(page, "meal menu", { overlay: true });
    await page.getByRole("menuitem", { name: "Move to" }).click();
    await expect(page.getByRole("menuitem", { name: /Saturday/ })).toBeVisible();
    await scan(page, "move-to submenu", { overlay: true });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await scan(page, "account menu", { overlay: true });
    await page.keyboard.press("Escape");
  });

  await test.step("recipes", async () => {
    await page.goto("/recipes");
    await scan(page, "my recipes");
    await page.goto("/recipes?tab=discover");
    await scan(page, "discover");
    await page.goto("/recipes?tab=collections");
    await scan(page, "collections");
    await page
      .getByRole("button", { name: "Import from URL" })
      .click()
      .catch(() => {});
    await page.goto("/recipes/new");
    await scan(page, "new recipe form");

    await page.goto("/recipes");
    await page
      .getByRole("link", { name: new RegExp(RECIPES.bowls) })
      .first()
      .click();
    await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/);
    await scan(page, "recipe detail");
    for (const tab of ["My Version", "Notes", "History", "Photos"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await scan(page, `recipe detail → ${tab}`);
    }
  });

  await test.step("kitchen", async () => {
    await page.goto("/kitchen");
    await scan(page, "kitchen (empty)");
    const add = page.getByLabel("Add a kitchen item");
    for (const line of ["2 onions", "rice"]) {
      await add.fill(line);
      await add.press("Enter");
    }
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(2);
    await scan(page, "kitchen");
  });

  await test.step("grocery list and prep plan", async () => {
    await page.goto("/grocery-list");
    await scan(page, "grocery list (empty)");
    await page.goto("/plan");
    await page.getByRole("button", { name: "Generate Grocery List" }).click();
    await page.waitForURL("**/grocery-list");
    await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();
    await scan(page, "grocery list");

    await page.goto("/plan");
    await page.getByRole("button", { name: "Create Prep Plan" }).click();
    await page.waitForURL("**/prep");
    await expect(page.getByText(/Used in:/).first()).toBeVisible();
    await scan(page, "prep plan");
  });

  await test.step("cooking", async () => {
    await page.goto("/plan");
    await page.getByRole("button", { name: `Options for ${RECIPES.patties}` }).click();
    await page.getByRole("menuitem", { name: "Cook this" }).click();
    await page.waitForURL(/\/cook\//);
    await scan(page, "cook mode");
    await page.getByRole("button", { name: "Mark as cooked" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "cooked dialog", { overlay: true });
    await page.keyboard.press("Escape");
  });

  await test.step("settings", async () => {
    await page.goto("/settings");
    await scan(page, "settings (free)");
    await page.getByRole("button", { name: "Try Pro locally (demo)" }).click();
    await expect(page.getByText("Pro is on (demo)").first()).toBeVisible();
    await scan(page, "settings (Pro)");
  });
});
