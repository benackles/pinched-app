# Pinched.

**Plan the week. Shop for what you're missing. Prep once. Cook faster.**

Pinched combines your recipe library, your kitchen inventory and a weekly meal plan into a grocery
list that only contains the gap, and one consolidated prep session — "chop the onions once for three
meals, cook one batch of rice for two". It's an installable PWA (Next.js, Supabase, Clerk, Stripe)
that works at the store with no signal.

The product spec is `Pinched — Product Requirements`; this repository implements its MVP.

## Try it in two minutes — no accounts, no keys

```bash
pnpm install
pnpm dev:local        # http://localhost:3000
```

Sign in with any email. **Local demo mode** runs the whole app on your machine: a real Postgres
(PGlite) with the real migrations and Row Level Security, the real `supabase-js` client, files on
disk, and a "Try Pro locally" switch in Settings instead of Stripe. It is refused when Clerk keys are
set or when running on Vercel, so it can never be switched on in a real deployment. Data lives in
`.pinched-local/` (git-ignored; delete it to start over).

The walkthrough the PRD calls the acceptance flow — sign up, import a recipe by URL, kitchen quick
add, plan four meals, grocery list, offline check-offs, prep plan, cook and rate — runs as an
automated test (`tests/e2e/acceptance.spec.ts`).

## What's in it

| Area         | What it does                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan**     | The home screen is the current week: meals by day, servings stepper, move between days, week navigation, four stat tiles. Generating a grocery list or prep plan is one tap.                                                                    |
| **Recipes**  | A seeded catalog, **URL import** (schema.org JSON-LD, one page at a time, author credited, the site's prose never copied), manual entry, collections, ratings, notes, **personal versions** that never touch the original, photos and video.    |
| **Kitchen**  | Quick add understands `2 onions`, `1 lb chicken thighs`, `rice`; pantry / fridge / freezer, optional expiry, mark out. Never changes on its own.                                                                                                |
| **Grocery**  | What the plan needs **minus** what the kitchen has — only on a confident match. Duplicates merged (`2 + 1 + ½ onion`), incompatible units kept apart, sorted into aisles, every row linked to its meals. Custom items, "already have", offline. |
| **Prep**     | Rules-based and explainable: chop/dice/slice/mince/cook-grains/sauce tasks grouped across meals, minutes estimated, passive work first, "used in" on every task. Edit, reorder, complete, move the prep day.                                    |
| **Cook**     | Scaled ingredients and steps, prep already done, mark cooked → rating and note → optional, never automatic, "update kitchen".                                                                                                                   |
| **Platform** | Installable PWA, the week and list open offline, grocery and prep check-offs queue and sync, push reminders (prep day, tonight's dinner) after install.                                                                                         |
| **Billing**  | Free tier and **Pinched Pro** ($5.99/mo or $39/yr, 14-day trial, card up front) through Stripe Checkout, webhooks and the billing portal.                                                                                                       |

Two principles shape the logic: **conservative beats clever** (an uncertain match stays on the list;
an ingredient is never silently dropped) and **everything generated stays editable** (regenerating a
list or plan merges with the person's edits instead of overwriting them).

## How it fits together

```
 Browser (PWA)                      Vercel                            Supabase
 ─────────────                      ──────                            ────────
 React 19 UI          ──Actions──▶  Next.js 16 (App Router)  ─────▶   Postgres + RLS  (auth.jwt()->>'sub')
 Service worker                     Server Components read            Storage (private bucket, signed URLs)
 IndexedDB queue                    Server Actions write (Zod)        Edge Function + pg_cron  → Web Push
 (offline check-offs)               Route Handlers: webhooks
        ▲                                   │
        │                                   ├── Clerk  (identity; Supabase trusts its session token)
        └── signed upload/read links ───────┴── Stripe (Checkout, portal, signed webhooks)
```

- **Identity and access.** Clerk signs people in; Supabase accepts Clerk's session token (Third-Party
  Auth). Every user-scoped table carries `user_id` and a Row Level Security policy on
  `auth.jwt()->>'sub'`. The app reads and writes _as the person_ (`userClient()`); the service-role
  key is used only by webhooks and jobs, and only with an id taken from a verified source.
- **Schema as code.** `src/db/schema.ts` (Drizzle) → `pnpm db:generate` → SQL migrations in
  `supabase/migrations`, applied with `supabase db push`. Hand-written SQL (grants, functions,
  triggers, storage policies) is added with `drizzle-kit generate --custom`. CI fails if the schema
  and migrations drift.
- **Free-tier limits** are enforced twice: in Server Actions (friendly errors) and by database
  triggers (the backstop), using one `user_is_pro()` function as the single definition of "Pro".
- **Offline.** The check-off queue lives in the app (IndexedDB), not in background sync, so every
  replay goes out with a fresh session token and still passes RLS. The service worker caches the
  shell, each screen's HTML (refreshed after use) and photos; it is bound to the signed-in person and
  purged on sign-out or when someone else signs in on the same device.
- **Recipe sources** sit behind a `RecipeProvider` interface (`src/lib/recipes/types.ts`): seeded
  catalog, URL import, manual entry — and a licensed API later.

### Project layout

```
src/app/            routes (App Router): (app)/plan, recipes, kitchen, grocery-list, prep, cook, settings; api/webhooks
src/components/     UI — app shell, screens, shadcn-style primitives in ui/
src/lib/            pure, framework-free logic: domain/ (ingredients, units, grocery, prep…), validation/,
                    offline/, pwa/, recipe-import/, media/, analytics/ — the most heavily tested code
src/server/         server-only: actions/ (Zod-validated mutations), queries/, billing/, media/, local/ (demo backend)
src/db/             Drizzle schema → types
supabase/           migrations/, seed.sql (generated), functions/send-reminders, cron/, config.toml
data/catalog/       the seeded recipes (JSON) → seed.sql
scripts/            catalog build, icon/art generation, VAPID keys
tests/              unit + database + RLS + e2e
```

## Configuration

Copy `.env.example` to `.env.local`. Every variable is documented there; in short:

| To turn on…       | Set                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Real accounts     | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`                      |
| Real data         | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only)       |
| Pinched Pro       | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `STRIPE_WEBHOOK_SECRET`                  |
| Push reminders    | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + the Edge Function's secrets (`supabase/functions/send-reminders/README.md`) |
| Product analytics | `POSTHOG_KEY` (optional `POSTHOG_HOST`) — server-side, no cookies, off when unset                            |

## Deploying

1. **Supabase.** Create a project. `supabase link`, then `supabase db push` (schema, RLS, storage
   bucket). Seed the catalog (see below). Authentication → Third-Party Auth → add **Clerk**.
2. **Clerk.** Enable Email and Google. Integrations → **Supabase** (so the session token carries the
   `authenticated` role). Add a webhook to `https://<domain>/api/webhooks/clerk` for `user.created`,
   `user.updated`, `user.deleted`.
3. **Stripe.** One product, two recurring prices ($5.99/month, $39/year). Add a webhook to
   `https://<domain>/api/webhooks/stripe` for `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.payment_failed`. Configure the Customer
   Portal.
4. **Vercel.** Import the repo, set the environment variables above. The service worker registers
   only on the production domain (`NEXT_PUBLIC_APP_URL`), never on preview deployments.
5. **Reminders.** `pnpm vapid:keys`, then follow `supabase/functions/send-reminders/README.md`
   (deploy the function, set secrets, run `supabase/cron/send-reminders.sql`).
6. **Smoke test** on a phone: the ten-step acceptance flow from the PRD, then install it.

### The seeded catalog

`data/catalog/*.json` holds the starter recipes (headnotes written for Pinched, ingredients and steps,
diet tags). `pnpm catalog:build` validates them and regenerates `supabase/seed.sql`; run the seed in
the Supabase SQL editor or via `supabase db reset` locally.

> **Launch content needs a human.** Per the PRD, AI-written headnotes and diet tags are reviewed before
> anything is published, so a recipe stays hidden (`published_at is null`) until it is marked
> `"reviewed": true` in its JSON. The repository ships **33 recipes, none reviewed yet** — so a
> production database starts with an empty Discover tab. Review them (diet tags matter for allergies)
> and set `reviewed`, or for staging run `pnpm catalog:build --publish-all`. The PRD's launch target is
> 150–300 recipes; the pipeline (schema validation, parser checks, seed generation) is in place to get
> there. Local demo mode publishes everything.

## Testing

```bash
pnpm test                  # ~700 unit + database tests, ~15 s
pnpm test:e2e              # real browser, phone + desktop (starts `next dev` for you)

pnpm build:e2e && E2E_PROD=1 pnpm test:e2e   # against a production build — also runs the offline specs
```

- **Unit and database** (`vitest`): ingredient parsing and merging, serving scaling, unit
  incompatibility, inventory subtraction, regeneration that keeps manual edits, prep grouping, URL
  import (valid, missing JSON-LD, bad URL, private addresses), **every Row Level Security rule and
  cross-user access** against a real Postgres (PGlite) running the real migrations, Stripe and Clerk
  webhooks (signatures, retries, out-of-order events), the reminder job, the offline queue.
- **End to end** (`playwright`): the PRD acceptance flow, offline behaviour with the real service
  worker (the network is cut at a TCP proxy, so the worker is offline too), media uploads, the free
  plan's gates, install prompts (including iPhone Safari), and an **axe-core accessibility scan** of
  every screen, menu and dialog on a phone and a desktop.
- Set `E2E_CHROMIUM_PATH` to use an existing Chromium instead of `playwright install`.

CI (`.github/workflows/ci.yml`) runs format, lint, types, catalog validation, a migration-drift check,
the unit/database tests, and the end-to-end suite against a production build.

## Conventions worth knowing

- **Design tokens** (`src/app/globals.css`, OKLCH) follow the PRD exactly; contrast is AA and the
  e2e suite enforces it. Filled buttons darken on hover rather than fade.
- **Server Actions** validate input with Zod, return `ActionResult` (never throw to the UI), and take
  the user from the session — never from the request. Mutations that work offline take a client
  timestamp and resolve last-write-wins per item.
- **Routes are typed** (`typedRoutes`); external redirects go through `external()` in `src/lib/routes.ts`.
- **No client-side secrets.** The Supabase service-role key, Stripe key and VAPID private key never
  reach the browser.
- **Migrations for every schema change**; never edit an applied migration.
- Next.js 16 differs from older versions — read `node_modules/next/dist/docs/` before changing
  framework-level code (see `AGENTS.md`).

## Privacy and analytics

Analytics are optional and server-side: anonymous events keyed by an opaque user id, only the
properties in `src/lib/analytics/events.ts` (counts and enumerations — never emails, names, recipe
titles or URL paths), no cookies, no autocapture, skipped for Global Privacy Control / Do Not Track.
Photos are re-encoded in the browser before upload, which drops embedded location data. Deleting an
account in Clerk deletes all of the person's data, files included.

## Known gaps and next steps

- **Catalog**: 33 unreviewed recipes vs. the 150–300 launch target (above).
- **Stripe Checkout and the billing portal** were exercised through the webhook tests and the demo
  switch, not against live Stripe — run the acceptance flow's step 10 in test mode before launch.
- **Clerk + Supabase Third-Party Auth** was developed against the local backend that mimics the same
  contract (RLS on the `sub` claim); confirm it once with real keys.
- **Push** needs the Edge Function deployed and a real device; the job itself is tested against a
  real Postgres with a recording sender.
- **Orphaned uploads**: a file uploaded but never attached (tab closed mid-way) is not yet swept.
- **Content-Security-Policy** is limited to `frame-ancestors`; a stricter policy needs testing with
  Clerk, Stripe and the service worker together.
- **Search rate limiting** (PRD security note) is not implemented; URL import is rate-limited.
- Out of MVP by design: household sharing, nutrition, barcode/receipt scanning, licensed recipe API.
