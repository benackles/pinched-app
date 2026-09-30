import "server-only";

import fs from "node:fs";
import path from "node:path";

import { buildCatalog, parseCatalog, type CatalogBuild } from "./build";

/** Reads every `data/catalog/*.json`, validates it, and builds the seed SQL. Throws on invalid data. */
export function loadCatalog(options: { publishAll?: boolean; dir?: string } = {}): CatalogBuild {
  const dir = options.dir ?? path.join(process.cwd(), "data", "catalog");
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const recipes = files.flatMap((name) =>
    parseCatalog(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")), name),
  );
  return buildCatalog(recipes, { publishAll: options.publishAll });
}
