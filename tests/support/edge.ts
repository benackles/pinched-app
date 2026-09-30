/**
 * Running a real Edge Function (supabase/functions/<name>/index.ts) under Deno in tests, with a real
 * Postgres (PGlite) answering as Supabase's REST API around it.
 *
 * Needs `deno` (CI installs it); tests skip where it is missing:
 *   DENO_BIN=/path/to/deno pnpm test tests/edge
 */
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { verifyJwt } from "@/server/local/jwt";
import { handlePostgrest, type Queryable } from "@/server/local/postgrest/handler";

import type { Db } from "./db";

export const DENO = process.env.DENO_BIN ?? "deno";

/** True when `command args…` runs and exits cleanly — a cheap "is this tool installed?". */
export function commandWorks(command: string, args: string[]): boolean {
  try {
    return spawnSync(command, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export const denoAvailable = commandWorks(DENO, ["--version"]);

/** Answer a request yourself (a stand-in for another Supabase service), or return null to pass it on. */
export type Interceptor = (request: http.IncomingMessage, body: Buffer) => Promise<Response | null>;

/**
 * Serves `db` the way Supabase's REST API does (`/rest/v1/…`), on a free local port. `intercept`
 * gets the first look at every request — that is where a stand-in for Storage goes.
 */
export async function startSupabase(db: Db, jwtSecret: string, intercept?: Interceptor) {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const result =
      (await intercept?.(request, body)) ??
      (await handlePostgrest(
        new Request(`http://shim.test${request.url}`, {
          method: request.method,
          headers: request.headers as Record<string, string>,
          ...(hasBody ? { body } : {}),
        }),
        { db: db as unknown as Queryable, verifyToken: (token) => verifyJwt(token, jwtSecret) },
      ));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Starts `supabase/functions/<name>/index.ts` and resolves with its base URL once it listens. */
export function startEdgeFunction(name: string, env: Record<string, string>) {
  const dir = `supabase/functions/${name}`;
  const child = spawn(
    DENO,
    [
      "run",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--allow-sys",
      "--config",
      `${dir}/deno.json`,
      `${dir}/index.ts`,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env, DENO_SERVE_ADDRESS: "tcp:127.0.0.1:0", NO_COLOR: "1" },
    },
  );
  return new Promise<{ url: string; stop: () => void }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the function did not start")), 120_000);
    const onData = (chunk: Buffer) => {
      const match = /Listening on (http:\/\/[^\s/]+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve({ url: match[1]!, stop: () => child.kill() });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.stdout?.on(
      "data",
      (chunk: Buffer) => process.env.EDGE_DEBUG && console.log("[fn]", chunk.toString()),
    );
    child.stderr?.on(
      "data",
      (chunk: Buffer) => process.env.EDGE_DEBUG && console.log("[fn!]", chunk.toString()),
    );
    child.on("exit", (code) => reject(new Error(`the function exited early (${code})`)));
  });
}
