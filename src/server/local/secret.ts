import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Where local mode keeps its database, secret and uploaded media. Never committed. */
export function localDataRoot(): string {
  return path.resolve(process.env.PINCHED_LOCAL_DIR ?? path.join(process.cwd(), ".pinched-local"));
}

let cached: string | undefined;

/**
 * Signing secret for local-mode session tokens. Persisted beside the local database so cookies
 * survive a restart; PINCHED_LOCAL_SECRET overrides it (used by tests).
 */
export function localSecret(): string {
  if (process.env.PINCHED_LOCAL_SECRET) return process.env.PINCHED_LOCAL_SECRET;
  if (cached) return cached;
  const file = path.join(localDataRoot(), "secret");
  try {
    cached = fs.readFileSync(file, "utf8").trim();
    if (cached) return cached;
  } catch {
    // first run
  }
  cached = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cached, { mode: 0o600 });
  return cached;
}
