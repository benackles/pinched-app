/**
 * Builds `supabase/seed.sql` from `data/catalog/*.json` and prints an issues report.
 *
 *   pnpm catalog:build              # recipes stay unpublished until marked "reviewed": true
 *   pnpm catalog:build --check      # validate only (CI); exit 1 on issues, write nothing
 *   pnpm catalog:build --publish-all  # dev convenience: publish every recipe regardless of review
 */
import fs from "node:fs";
import path from "node:path";

import { buildCatalog, parseCatalog } from "../src/lib/catalog/build";

const args = new Set(process.argv.slice(2));
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data", "catalog");

const recipes = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .flatMap((name) => parseCatalog(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")), name));

const build = buildCatalog(recipes, { publishAll: args.has("--publish-all") });
const reviewed = build.recipes.filter((recipe) => recipe.reviewed).length;

console.log(
  `${build.recipes.length} recipes · ${reviewed} reviewed · ${build.issues.length} issue(s)`,
);
for (const issue of build.issues) console.log(`  ${issue.slug}: ${issue.message}`);

if (args.has("--check")) process.exit(build.issues.length ? 1 : 0);

fs.writeFileSync(path.join(root, "supabase", "seed.sql"), build.sql);
console.log("wrote supabase/seed.sql");
