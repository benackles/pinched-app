import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A clean slate for uploaded files and the local secret (the database itself is in memory). */
export default function globalSetup() {
  fs.rmSync(path.join(os.tmpdir(), "pinched-e2e"), { recursive: true, force: true });
}
