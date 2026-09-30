/**
 * The free plan's limits and what Pro unlocks, end to end. (Stripe Checkout and the billing portal
 * need real Stripe keys, so they are exercised by the webhook tests and by hand; this covers how the
 * product behaves on each side of the gate.)
 */
import { currentWeekStart, shiftWeek } from "@/lib/domain/week";

import { addMealOnDay, RECIPES, saveCatalogRecipe, signIn, watchForErrors } from "./support/app";
import { expect, test } from "./support/test";

test("Free gets the prep plan for two weeks; the third needs Pro, and Pro unlocks it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await signIn(page, "billing");
  await saveCatalogRecipe(page, RECIPES.bowls);

  const thisWeek = currentWeekStart("America/Los_Angeles");
  const weeks = [thisWeek, shiftWeek(thisWeek, 1), shiftWeek(thisWeek, 2)];
  for (const week of weeks) await addMealOnDay(page, 1, RECIPES.bowls, week);

  await test.step("the first two weeks get a prep plan", async () => {
    for (const week of weeks.slice(0, 2)) {
      await page.goto(`/plan?week=${week}`);
      await page.getByRole("button", { name: "Create Prep Plan" }).click();
      await page.waitForURL(/\/prep/);
      await expect(page.getByText(/Used in:/).first()).toBeVisible();
    }
  });

  await test.step("the third week is locked, with a way to upgrade — and nothing is lost", async () => {
    await page.goto(`/prep?week=${weeks[2]}`);
    await expect(page.getByRole("heading", { name: "Unlock prep for every week" })).toBeVisible();
    await page.getByRole("link", { name: /See Pinched Pro/ }).click();
    await page.waitForURL(/\/settings#billing/);
    await expect(page.getByText("Weeks with a prep plan")).toBeVisible();
    await expect(page.getByText(/^2 of 2$/)).toBeVisible();

    // Trying to build it from the plan screen explains why, too.
    await page.goto(`/plan?week=${weeks[2]}`);
    await page.getByRole("button", { name: "Create Prep Plan" }).click();
    await expect(
      page.getByText(/prep plan for their first 2 weeks|Upgrade to Pro/i).first(),
    ).toBeVisible();

    // The earlier weeks' plans are still there.
    await page.goto(`/prep?week=${weeks[0]}`);
    await expect(page.getByText(/Used in:/).first()).toBeVisible();
  });

  await test.step("Pro unlocks the third week", async () => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Try Pro locally (demo)" }).click();
    await expect(page.getByText("Pro is on (demo)").first()).toBeVisible();

    await page.goto(`/prep?week=${weeks[2]}`);
    await expect(page.getByRole("heading", { name: "Unlock prep for every week" })).toHaveCount(0);
    await page.getByRole("button", { name: "Create prep plan" }).click();
    await expect(page.getByText(/Used in:/).first()).toBeVisible();
  });

  expect(errors).toEqual([]);
});
