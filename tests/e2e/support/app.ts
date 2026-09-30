import { expect, type Page } from "@playwright/test";

/** A fresh person for every test: local mode signs in with any email and creates the account. */
export async function signIn(page: Page, label = "e2e"): Promise<string> {
  const email = `${label}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/sign-in");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForURL("**/plan", { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: /This Week/ })).toBeVisible();
  return email;
}

/** The seeded catalog titles the tests plan with. */
export const RECIPES = {
  bowls: "Chicken Rice Bowls",
  patties: "Turkey Patties with Yogurt Sauce",
  sheetPan: "Sheet-Pan Chicken & Sweet Potatoes",
  curry: "Weeknight Chicken Curry",
} as const;

export async function saveCatalogRecipe(page: Page, title: string) {
  await page.goto("/recipes?tab=discover");
  await page.getByRole("button", { name: `Save ${title}` }).click();
  await expect(page.getByText("Saved to My Recipes").first()).toBeVisible();
}

/** Adds a recipe to the nth day (0 = Monday) of the week shown on /plan. */
export async function addMealOnDay(page: Page, dayIndex: number, title: string) {
  await page.goto("/plan");
  // One "Add meal to this day" button per day; the page header's "Add Meal" has a different name.
  await page
    .getByRole("button", { name: /Add meal to this day/ })
    .nth(dayIndex)
    .click();
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Add to week" }).click();
  await expect(page.getByText(/added to/).first()).toBeVisible();
}

/** The names shown under "Already have" on the grocery list. */
export async function alreadyHave(page: Page): Promise<string[]> {
  const section = page.getByRole("region", { name: "Already have" });
  if ((await section.count()) === 0) return [];
  return (await section.getByRole("button").allTextContents()).map((text) =>
    text
      .replace(/—\s*move back to the list/i, "")
      .trim()
      .toLowerCase(),
  );
}

/** The aisle sections on the grocery list, each with the names of the items to buy. */
export async function aisles(page: Page): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const sections = page.locator("section[aria-labelledby^='aisle-']");
  for (let i = 0; i < (await sections.count()); i++) {
    const section = sections.nth(i);
    const heading = (await section.getByRole("heading", { level: 2 }).innerText()).trim();
    const items = await section
      .getByRole("button", { name: /^Edit / })
      .evaluateAll((buttons) =>
        buttons.map((b) =>
          (b.getAttribute("aria-label") ?? "").replace(/^Edit /, "").toLowerCase(),
        ),
      );
    out[heading] = items;
  }
  return out;
}

/** A planned meal's card on /plan, found through its options button. */
export function mealCard(page: Page, title: string) {
  return page
    .getByRole("button", { name: `Options for ${title}` })
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
}

/** The section for one day on /plan ("Saturday"), found through its heading. */
export function daySection(page: Page, day: string) {
  return page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: new RegExp(`^${day}`) }),
  });
}

/** A prep task's row on /prep, found through its complete checkbox. */
export function prepTask(page: Page, title: string | RegExp) {
  return page
    .getByRole("checkbox", { name: typeof title === "string" ? `Complete ${title}` : title })
    .locator("xpath=ancestor::li[1]");
}

/**
 * Collects anything the browser logs as an error or throws as an uncaught exception, so a test can
 * assert that a whole flow ran clean. Expected noise (a blocked request while offline) is ignored.
 */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // The browser reports failed fetches while we deliberately go offline, and missing optional assets.
    if (/Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(text))
      return;
    errors.push(`console: ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
  return errors;
}
