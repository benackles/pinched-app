/** Settings: preferences stick, and the Pro gates open and close with the plan. */
import { signIn, watchForErrors } from "./support/app";
import { expect, test } from "./support/test";

test("prep day and reminders persist; Pro unlocks reminders; the plan summary follows", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await signIn(page, "settings");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await test.step("prep day is saved", async () => {
    await page.getByLabel("Usual prep day").selectOption("7");
    await expect(page.getByText("Prep day saved").first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Usual prep day")).toHaveValue("7");
  });

  await test.step("Free: reminders are a Pro feature, usage is shown", async () => {
    await expect(page.getByText("Push reminders are part of Pinched Pro.")).toBeVisible();
    await expect(page.getByText("You're on the free plan.")).toBeVisible();
    await expect(page.getByText("Saved recipes", { exact: true })).toBeVisible();
    await expect(page.getByText(/^0 of 25$/)).toBeVisible();
    // Checkout needs Stripe; without keys it says so instead of failing.
    await expect(
      page.getByRole("button", { name: /Start 14-day free trial/ }).first(),
    ).toBeDisabled();
  });

  await test.step("Pro: reminder preferences are editable and saved", async () => {
    await page.getByRole("button", { name: "Try Pro locally (demo)" }).click();
    await expect(page.getByText("Pro is on (demo)").first()).toBeVisible();
    await expect(page.getByText(/^Renews on /)).toBeVisible();

    const dinner = page.getByRole("switch", { name: "Tonight's dinner" });
    await expect(dinner).toBeChecked(); // defaults on — but nothing is sent until a device opts in
    await dinner.click();
    await expect(dinner).not.toBeChecked();
    await page.getByLabel("Remind me at").fill("18:30");
    await page.getByLabel("Remind me at").blur();
    await expect(page.getByText("Time saved").first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("switch", { name: "Tonight's dinner" })).not.toBeChecked();
    await expect(page.getByLabel("Remind me at")).toHaveValue("18:30");
    await expect(page.getByText("This device: reminders off")).toBeVisible();
  });

  await test.step("back to Free", async () => {
    await page.getByRole("button", { name: "Switch to Free (demo)" }).click();
    await expect(page.getByText("You're on the free plan.")).toBeVisible();
    await expect(page.getByText("Push reminders are part of Pinched Pro.")).toBeVisible();
  });

  expect(errors).toEqual([]);
});
