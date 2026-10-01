# Deploying: local → GitHub → Vercel

How a change travels, how to set it all up once, and what to do when something is off.

## How changes flow

```
your computer         pnpm dev:local, pnpm check
      │  git push a branch, open a pull request
      ▼
GitHub                CI: format, lint, types, ~700 tests, then the browser tests on a production build
      │                  └─ Vercel builds a Preview deployment of the branch (its own URL)
      │  merge to main
      ▼
Vercel                Production deployment (your domain)

Supabase              database, storage and Edge Functions are separate: schema changes go there
                      with the Supabase CLI (see "Changing the database")
```

- `main` is the production line. Work on branches and merge through pull requests.
- Make CI a gate: GitHub → Settings → Branches → add a rule for `main` that requires the checks
  **Lint, types, unit tests** and **End-to-end (real browser, production build)** to pass.
- Vercel builds every branch you push as a Preview. Delete branches you no longer need.

## One-time setup, in this order

1. **GitHub.** Make `main` the default branch (Settings → Branches). Vercel's production branch
   follows it.
2. **Supabase.** Create a project in the region closest to your Vercel functions (Vercel's default is
   Washington DC, so `us-east-1`). Then `supabase login`, `supabase link --project-ref <ref>`,
   `supabase db push` (schema, row-level security, the private media bucket). Seed the catalog (README →
   "The seeded catalog").
3. **Clerk.** Create an application, enable Email and Google, and turn on Integrations → **Supabase**
   (it adds the `authenticated` role to session tokens). Then, in Supabase, Authentication → Sign In /
   Up → Third-Party Auth → add **Clerk**. A Clerk _production_ instance needs a domain you own; until
   you have one, use the _development_ keys in Production too, and switch when the domain is ready.
4. **Stripe.** One product with two recurring prices ($5.99 a month, $39 a year) and the Customer
   Portal configured. Stay in test mode until you want to take real payments.
5. **Vercel.** New Project → import this repository. Next.js is detected; the defaults are right
   (`pnpm build`, Node 22 from `engines`, production branch `main`). Add the environment variables
   below **before** the first deploy, because `NEXT_PUBLIC_*` values are baked in at build time.
   Vercel's free Hobby plan is for non-commercial use, so a product that takes payments belongs on Pro.
6. **Webhooks**, once you know the domain: Clerk → `https://<domain>/api/webhooks/clerk`
   (`user.created`, `user.updated`, `user.deleted`) and Stripe → `https://<domain>/api/webhooks/stripe`
   (`checkout.session.completed`, `customer.subscription.created|updated|deleted`,
   `invoice.payment_failed`). Put each endpoint's signing secret in Vercel and redeploy.
7. **Edge Functions** (reminders, upload cleanup) run on Supabase, not Vercel: follow
   `supabase/functions/send-reminders/README.md` and `supabase/functions/cleanup-media/README.md`.

## Environment variables

Set them in Vercel → Project → Settings → Environment Variables, and scope each one: **Production**,
**Preview**, or both. Keep Preview pointed at test services so a pull request can never touch real
data: a second (staging) Supabase project, Clerk development keys, Stripe test keys.

| Variable                                                    | Production                                        | Preview           | Notes                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                         | Clerk production (or dev)                         | Clerk development | Public. Baked in at build.                                                          |
| `CLERK_SECRET_KEY`                                          | matching secret                                   | matching secret   | Secret.                                                                             |
| `CLERK_WEBHOOK_SIGNING_SECRET`                              | the production endpoint's                         | optional          | Secret. Each endpoint has its own.                                                  |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production project                                | staging project   | Public. Baked in at build.                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | production project                                | staging project   | Secret. Server only; never give it a `NEXT_PUBLIC_` name.                           |
| `STRIPE_SECRET_KEY`                                         | live (test until launch)                          | test              | Secret.                                                                             |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`               | matching prices                                   | test prices       |                                                                                     |
| `STRIPE_WEBHOOK_SECRET`                                     | the production endpoint's                         | optional          | Secret.                                                                             |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`                              | from `pnpm vapid:keys`                            | optional          | Public. Push reminders.                                                             |
| `NEXT_PUBLIC_APP_URL`                                       | your canonical domain, e.g. `https://pinched.app` | **leave unset**   | Pins the service worker to that host. Previews use their own address automatically. |
| `POSTHOG_KEY`, `POSTHOG_HOST`                               | optional                                          | leave unset       | Analytics are off when unset.                                                       |

Never set `PINCHED_LOCAL*`, `PINCHED_IMPORT_ALLOW_PRIVATE` or `NEXT_PUBLIC_PWA_ALLOW_LOCALHOST` on
Vercel. Local demo mode is refused there on purpose. Vercel's own variables (`VERCEL_ENV`,
`VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) must stay exposed ("Automatically expose System
Environment Variables", on by default): the app builds its Stripe return links from them when
`NEXT_PUBLIC_APP_URL` is unset.

Previews are behind Vercel Authentication by default, so Clerk and Stripe webhooks cannot reach them.
Webhooks belong to Production (and to a stable staging domain, if you add one).

## Changing the database

1. Edit `src/db/schema.ts` and run `pnpm db:generate` (or `drizzle-kit generate --custom --name=…`
   for hand-written SQL). Commit the migration.
2. `pnpm check`. The tests apply every migration to a real Postgres and check every row-level
   security rule.
3. Apply it to Supabase **before** the code that needs it goes live: `supabase db push` against
   staging while the pull request is open, against production just before you merge. Keep each change
   backwards compatible for one deploy (add first, remove in a later change), because the old code
   keeps serving until the new deployment is ready.
4. Merge. Vercel deploys.

Migrations only go forward. Vercel's **Instant Rollback** restores the previous _code_, not the
database, which is one more reason to add before you remove.

## After every deploy

Run the PRD's acceptance flow on the real site (README → Testing): sign up, import a recipe by URL,
plan, grocery list, prep plan, cook and rate. On Production also: upgrade with Stripe's test card
`4242 4242 4242 4242`, open **Manage plan**, and install the app on a phone.

## When something is off

- **The sign-in page says sign-in isn't set up.** The Clerk keys were missing at _build_ time. Add them
  in Vercel and redeploy (Deployments → ⋯ → Redeploy).
- **A webhook returns 400.** The signing secret belongs to a different endpoint. Copy the right one
  into Vercel and redeploy.
- **Stripe sends people back to the wrong site.** `NEXT_PUBLIC_APP_URL` is set where it shouldn't be
  (it is for Production only), or Vercel's system variables are switched off.
- **A phone shows an old version.** The service worker updates on the next visit. `?sw=off` on any
  address opts that session out while you debug.
- **"Local demo mode"** never appears on Vercel. That guard is deliberate.
