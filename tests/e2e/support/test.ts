import { test as base } from "@playwright/test";

import { startRecipeSite } from "./recipe-site";

type Workers = { recipeSite: { url: string } };

/** Playwright's `test`, plus a local recipe website for URL-import tests. */
export const test = base.extend<object, Workers>({
  recipeSite: [
    async ({}, use) => {
      const site = await startRecipeSite();
      await use({ url: site.url });
      await site.close();
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
