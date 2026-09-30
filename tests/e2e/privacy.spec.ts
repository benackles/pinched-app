/**
 * Missing things get a friendly page, and other people's things look exactly like missing things:
 * what one person adds is invisible to everyone else, at the address level.
 */
import AxeBuilder from "@axe-core/playwright";

import { signIn, watchForErrors } from "./support/app";
import { expect, test } from "./support/test";

const NOBODY = "00000000-0000-4000-8000-000000000000";

test("missing recipes, lists and meals say so; unknown addresses get the branded 404", async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await signIn(page, "missing");

  for (const path of [
    `/recipes/${NOBODY}`,
    `/recipes/${NOBODY}/edit`,
    "/recipes/not-a-real-id",
    `/collections/${NOBODY}`,
    `/cook/${NOBODY}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "We couldn't find that." }), path).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your week" })).toBeVisible();
  }
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude("nextjs-portal")
    .analyze();
  expect(scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  const response = await page.goto("/definitely-not-a-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your week" }).click();
  await page.waitForURL("**/plan");

  expect(errors).toEqual([]);
});

test("one person's recipe cannot be opened, edited or found by another", async ({ browser }) => {
  test.setTimeout(120_000);

  // Alice writes a private recipe.
  const alice = await (await browser.newContext()).newPage();
  await signIn(alice, "alice");
  await alice.goto("/recipes/new");
  await alice.fill("#r-title", "Alice's Secret Sauce");
  await alice.fill("#r-ingredients", "1 cup tomatoes\n2 tbsp olive oil\n1 clove garlic");
  await alice.fill("#r-steps", "Simmer everything together for 20 minutes.\nBlend until smooth.");
  await alice.getByRole("button", { name: "Save recipe" }).click();
  await alice.waitForURL(/\/recipes\/[0-9a-f-]{36}$/);
  const url = new URL(alice.url());
  await expect(
    alice.getByRole("heading", { level: 1, name: "Alice's Secret Sauce" }),
  ).toBeVisible();

  // Bob, signed in on his own, gets "not found" for it — the page, the editor, the list and search.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await signIn(bob, "bob");
  for (const path of [url.pathname, `${url.pathname}/edit`]) {
    await bob.goto(path);
    await expect(bob.getByRole("heading", { name: "We couldn't find that." }), path).toBeVisible();
    await expect(bob.getByText("Alice's Secret Sauce")).toHaveCount(0);
  }
  await bob.goto("/recipes?q=Secret");
  await expect(bob.getByText("Alice's Secret Sauce")).toHaveCount(0);
  await bob.goto("/recipes?tab=discover&q=Secret");
  await expect(bob.getByText("Alice's Secret Sauce")).toHaveCount(0);

  // A signed-out visitor is sent to sign in.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url.pathname);
  await visitor.waitForURL("**/sign-in");

  // …and Alice still has hers.
  await alice.goto("/recipes");
  await expect(alice.getByText("Alice's Secret Sauce").first()).toBeVisible();
});
