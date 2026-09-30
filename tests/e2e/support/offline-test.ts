import { test as base } from "@playwright/test";

import { startProxy, type FlakyProxy } from "./network";

const port = Number(process.env.E2E_PORT ?? 3200);

type Network = { setOffline(offline: boolean): Promise<void> };

/**
 * `test` for the offline specs: the page talks to the app through a proxy whose network can be
 * cut, and `network.setOffline()` cuts it for the page AND the service worker, the way airplane
 * mode does (it also tells the page, so `navigator.onLine` flips and the offline events fire).
 */
export const test = base.extend<{ network: Network }, { flakyProxy: FlakyProxy }>({
  flakyProxy: [
    async ({}, provide) => {
      const flakyProxy = await startProxy({ host: "127.0.0.1", port });
      await provide(flakyProxy);
      await flakyProxy.close();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ flakyProxy }, provide) => {
    await provide(flakyProxy.url);
  },
  network: async ({ context, flakyProxy }, provide) => {
    await provide({
      async setOffline(offline) {
        flakyProxy.setOffline(offline);
        await context.setOffline(offline);
      },
    });
    flakyProxy.setOffline(false);
  },
});

export { expect } from "@playwright/test";
