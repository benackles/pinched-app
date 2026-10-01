<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Pinched — notes for agents

The product spec is the PRD (`Pinched — Product Requirements`). **Add no non-MVP features**; follow
its implementation guidance: the week is the primary workflow, conservative matching, never silently
drop an ingredient, every generated row stays linked to its meals, generated outputs stay editable
(regeneration keeps manual edits), no automatic inventory deduction, personal versions never change
the original, a migration for every schema change.

## Commands

```bash
pnpm dev:local                 # whole app, no credentials (PGlite + real migrations/RLS); sign in with any email
pnpm check                     # format:check + lint + typecheck + test — what CI's first job runs; run before committing
pnpm test                      # vitest: domain logic, every migration and RLS rule, webhooks, reminder job
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:e2e                  # Playwright (phone + desktop); E2E_PROD=1 after `pnpm build:e2e` adds the offline specs
pnpm db:generate               # schema.ts → a new migration;  `drizzle-kit generate --custom --name=x` for hand-written SQL
pnpm catalog:build [--check]   # data/catalog/*.json → supabase/seed.sql
```

Optional tools: `deno` + `openssl` run the Edge Function tests (skipped without them; `DENO_BIN=/path`
to point at one); `E2E_CHROMIUM_PATH=/path` uses an existing Chromium instead of `playwright install`.

## How it ships

Local → GitHub → Vercel (Production from `main`, a Preview per branch); Supabase and its Edge
Functions are separate. The guide, with the env vars per environment, is `docs/deploying.md`. Never set
`PINCHED_LOCAL` on Vercel (it is refused there), and give a secret a `NEXT_PUBLIC_` name never.

## Where things stand

The PRD's MVP is implemented and tested (about 700 unit/database/RLS tests; Playwright on phone and
desktop, including the acceptance flow, offline behaviour and an axe accessibility scan). What is **not**
verified against real services is listed in README → "Known gaps and next steps": live Stripe Checkout
and portal, Clerk + Supabase third-party auth, push delivery through a real browser push service, and
the orphaned-upload sweep on hosted Storage. The seeded catalog is 33 recipes, none marked `reviewed`.

## Where things live

- `src/lib/**` is pure and framework-free (domain, validation, offline queue, import, media rules) —
  put logic here and test it. `src/server/**` is `server-only`: Server Actions (`actions/`), queries,
  billing, media stores, and `local/` (the demo backend: a PostgREST-compatible shim over PGlite).
- Server Actions: validate with Zod, return `ActionResult` through `runAction`, take the user from the
  session (`requireSession()`), never from input. `"use server"` files may export only async functions.
- Reads/writes for a person go through `userClient()` (RLS applies). `adminClient()` (service role) is
  for webhooks and jobs only, with an id from a verified source.
- Offline: check-offs go through `src/lib/offline/queue.ts` (IndexedDB); the UI reads the queue through
  `queue-store.ts`. The service worker is `src/app/sw.ts`.

## Gotchas learned the hard way

- React-compiler lint rules are on: no `setState` in effects, no impure calls (`Date.now()`) during
  render, no variable reassignment inside `.map`. Use `useSyncExternalStore` for external stores.
- Do not gate an effect on a "first run" ref — React Strict Mode runs effects twice in development.
- A disabled submit button blocks Enter in its form.
- `next build` type-checks only the app (`tsconfig.build.json`); `pnpm typecheck` covers tests/scripts.
- Production builds use webpack (`next build --webpack`) because Serwist requires it.
- Local mode refuses to run with Clerk keys or on Vercel. Never weaken that guard.
- Offline e2e cuts the network at a TCP proxy: Playwright's `setOffline` does not reliably reach the
  service worker.
