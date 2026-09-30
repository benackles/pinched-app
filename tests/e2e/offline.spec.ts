/**
 * The installed-app promise: the week opens with no signal, grocery check-offs made offline sync
 * when the connection returns, and signing out leaves nothing of the person on the device.
 *
 * Needs a production build (the service worker is off in development):
 *   pnpm build:e2e && E2E_PROD=1 pnpm test:e2e tests/e2e/offline.spec.ts
 */
import { addMealOnDay, RECIPES, saveCatalogRecipe, signIn, watchForErrors } from "./support/app";
import { expect, test } from "./support/offline-test";

test.skip(
  process.env.E2E_PROD !== "1",
  "needs a production build — the service worker is off in development",
);

const cacheKeys = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      if (name.startsWith("serwist")) continue;
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname);
    }
    return out;
  });

test("opens offline, queues check-offs, syncs, and signs out clean", async ({ page, network }) => {
  test.setTimeout(240_000);
  const errors = watchForErrors(page);

  await signIn(page, "offline");

  await test.step("the service worker takes control and the main screens are cached", async () => {
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), {
        timeout: 20_000,
      })
      .toMatch(/\/sw\.js$/);
    await expect
      .poll(async () => (await cacheKeys(page)).pages ?? [], { timeout: 30_000 })
      .toEqual(expect.arrayContaining(["/plan", "/recipes", "/kitchen", "/grocery-list", "/prep"]));
  });

  await test.step("set up a week with a grocery list", async () => {
    await saveCatalogRecipe(page, RECIPES.bowls);
    await addMealOnDay(page, 1, RECIPES.bowls);
    await page.getByRole("button", { name: "Generate Grocery List" }).click();
    await page.waitForURL("**/grocery-list");
    await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();
    // The worker refreshes a screen's cached copy a moment after it is used, so going offline
    // right now would still show the older copy. Wait until the list itself has been stored.
    await page.goto("/plan");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cached = await (await caches.open("pages")).match("/grocery-list");
          return cached ? (await cached.text()).includes("Produce") : false;
        }),
      )
      .toBe(true);
  });

  await test.step("no signal: the plan and the list still open", async () => {
    await network.setOffline(true);
    await page.goto("/plan");
    await expect(page.getByRole("heading", { level: 1, name: /This Week/ })).toBeVisible();
    await expect(page.getByText(RECIPES.bowls).first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Offline" }).first()).toBeVisible();

    // "Grocery List" in the header, "Grocery" in the phone's tab bar
    await page
      .getByRole("link", { name: /^Grocery( List)?$/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();
  });

  await test.step("check-offs made offline show at once and are waiting to sync", async () => {
    const boxes = page.getByRole("checkbox");
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await expect(page.getByRole("status").filter({ hasText: "2 to sync" })).toBeVisible();
    // and they survive a reload, still offline
    await page.reload();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  });

  await test.step("a screen that was never opened says so, instead of a browser error", async () => {
    await page.goto("/settings");
    await expect(page.getByText(/You.re offline/)).toBeVisible();
    await expect(page.getByText(/hasn.t been opened on this phone yet/)).toBeVisible();
  });

  await test.step("back online: the changes sync and stay", async () => {
    await network.setOffline(false);
    await page.goto("/grocery-list");
    await expect(page.getByText("Synced 2 offline changes")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  });

  await test.step("signing out clears the person's pages, data and photos from the device", async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(
      (url) => !/\/(plan|grocery-list|prep|kitchen|recipes)/.test(url.pathname),
    );
    await expect
      .poll(async () => {
        const all = await cacheKeys(page);
        return ["pages", "pages-rsc", "pinched-data", "pinched-media", "start-url"].reduce(
          (sum, name) => sum + (all[name]?.length ?? 0),
          0,
        );
      })
      .toBe(0);
  });

  await test.step("the next person on the same device never sees the last person's week", async () => {
    await signIn(page, "second");
    await page.reload();
    await expect
      .poll(async () => (await cacheKeys(page)).pages ?? [], { timeout: 30_000 })
      .toEqual(expect.arrayContaining(["/plan", "/grocery-list"]));
    await network.setOffline(true);
    await page.goto("/plan");
    await expect(page.getByText("Nothing planned.").first()).toBeVisible();
    await expect(page.getByText(RECIPES.bowls)).toHaveCount(0);
    await network.setOffline(false);
  });

  expect(errors).toEqual([]);
});
