import net from "node:net";

/**
 * A TCP proxy in front of the app whose network can be cut. Playwright's `context.setOffline()`
 * only affects the page, not always the service worker's own requests; closing the connection
 * really does what airplane mode does to every request, the worker's included.
 */
export type FlakyProxy = {
  /** Open this instead of the app's own URL. */
  url: string;
  /** Cut (or restore) every connection through the proxy. */
  setOffline(offline: boolean): void;
  close(): Promise<void>;
};

export async function startProxy(target: { host: string; port: number }): Promise<FlakyProxy> {
  let offline = false;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    if (offline) {
      client.destroy();
      return;
    }
    const upstream = net.connect(target.port, target.host);
    sockets.add(client);
    sockets.add(upstream);
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", close).on("close", close);
    upstream.on("error", close).on("close", close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://localhost:${port}`,
    setOffline(value) {
      offline = value;
      if (value) for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
