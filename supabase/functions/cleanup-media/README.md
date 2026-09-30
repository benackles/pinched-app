# cleanup-media

A daily sweep for **photos and videos that were uploaded but never attached to a recipe**.

Uploads go straight from the browser to Storage and are attached to the recipe afterwards. A tab
closed in between, a failed attach, or a removal Storage never finished leaves a file nobody can see
or delete — and that still counts against storage. This job finds those files and removes them.

## How it decides

| Piece                          | What it does                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orphaned_media_objects()` SQL | Files in the `recipe-media` bucket **older than a day** (the grace period) that **no `recipe_media` row points at**, oldest first, up to 1000 a call. Service role only. |
| `core.ts`                      | The job: asks the database, removes the files in batches of 100, reports what it did. Stops when nothing is left, when a round removed nothing, or after 20 rounds.      |
| `index.ts`                     | The Edge Function entry: checks the shared secret, wires in the service-role client and Storage's `remove`.                                                              |

- **Removal goes through the Storage API.** Deleting rows from `storage.objects` would leave the
  bytes behind, so the function never does that.
- **An upload in progress is safe**: nothing younger than a day is considered, and a signed upload
  link expires within hours.
- **A refused batch is left for the next run**; the others still go. The summary says how many
  failed and whether more are waiting.
- Attached files and files in other buckets are never touched, and no recipe data is changed.

## Deploy

```bash
# 1. The shared secret for the cron job (no other secrets needed)
supabase secrets set CLEANUP_CRON_SECRET="$(openssl rand -hex 32)"

# 2. Deploy (the gateway's JWT check is off; the shared secret is the way in)
supabase functions deploy cleanup-media --no-verify-jwt

# 3. Schedule it: run supabase/cron/cleanup-media.sql in the SQL editor
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically.

## Try it

```sql
-- What the next run would remove (SQL editor only — the function is not callable by app users):
select * from public.orphaned_media_objects();
```

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/cleanup-media" \
  -H "Authorization: Bearer $CLEANUP_CRON_SECRET"
# → {"found":3,"removed":3,"failed":0,"rounds":2,"more":false}
```

The response only ever contains counts — file names contain people's ids, so they are never returned
or logged. Tests: `pnpm test tests/media` (the SQL function against a real Postgres, and the job
with Storage replaced by a stand-in), and `pnpm test tests/edge`, which runs **this function under
Deno** with the real `supabase-js` against a stand-in for Storage's delete endpoint (it needs
`deno`, and is skipped without it — `DENO_BIN=/path/to/deno` to point at one).
