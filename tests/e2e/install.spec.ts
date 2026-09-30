/**
 * The install moment (PRD → Install and push): offered after the first grocery list or prep plan,
 * tied to a benefit, dismissible, and not repeated. iPhone Safari has no install event, so it gets
 * a two-step visual guide instead.
 */
import { addMealOnDay, RECIPES, saveCatalogRecipe, signIn } from "./support/app";
import { expect, test } from "./support/test";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.describe("on iPhone Safari", () => {
  test.use({ userAgent: IPHONE });

  test("a two-step guide appears after the first grocery list, once", async ({ page }) => {
    await signIn(page, "install-ios");
    await saveCatalogRecipe(page, RECIPES.bowls);
    await addMealOnDay(page, 1, RECIPES.bowls);

    // Nothing before there is something to come back for.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Generate Grocery List" }).click();
    const sheet = page.getByRole("dialog", { name: "Add Pinched to your Home Screen" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/reminder when it.s time to prep/i)).toBeVisible();
    await expect(sheet.getByText("Tap the Share button")).toBeVisible();
    await expect(sheet.getByText(/Add to Home Screen/).first()).toBeVisible();
    await sheet.getByRole("button", { name: "Not now" }).click();
    await expect(sheet).toHaveCount(0);

    // Dismissed: building the prep plan (another first) doesn't ask again this week.
    await page.goto("/plan");
    await page.getByRole("button", { name: "Create Prep Plan" }).click();
    await page.waitForURL("**/prep");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Settings still explains how, whenever they want it.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Install the app" })).toBeVisible();
    await expect(page.getByText(/Tap the Share button/)).toBeVisible();
  });
});

test.describe("in a browser that can install", () => {
  test("the browser's own install prompt is offered after the first list, then used", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // What Chrome fires when the app is installable.
      const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          (window as unknown as { __installPrompted: boolean }).__installPrompted = true;
        },
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      window.addEventListener("load", () => setTimeout(() => window.dispatchEvent(event), 200));
    });
    await signIn(page, "install-chrome");
    await saveCatalogRecipe(page, RECIPES.bowls);
    await addMealOnDay(page, 1, RECIPES.bowls);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Generate Grocery List" }).click();
    const sheet = page.getByRole("dialog", { name: "Install Pinched" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Install" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __installPrompted?: boolean }).__installPrompted,
        ),
      )
      .toBe(true);
  });

  test("a browser with no install support is never nagged", async ({ page }) => {
    await signIn(page, "install-none");
    await saveCatalogRecipe(page, RECIPES.bowls);
    await addMealOnDay(page, 1, RECIPES.bowls);
    await page.getByRole("button", { name: "Generate Grocery List" }).click();
    await page.waitForURL("**/grocery-list");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
