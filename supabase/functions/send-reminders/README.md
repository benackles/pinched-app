# send-reminders

Push reminders for Pinched Pro: the **prep-day reminder** and **tonight's dinner**, at the time of
day each person picks, in their own time zone. Opt-in only, and only for people with Pro and at
least one device registered in Settings.

## How it decides

| Piece                         | What it does                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reminder_recipients()` (SQL) | Pro (`user_is_pro`) + a reminder on + a device. Service role only.                                                                                                                                             |
| `_shared/reminders.ts`        | Pure rules and wording: is it inside the person's window (their chosen time → one hour later, never past midnight), and what to say.                                                                           |
| `core.ts`                     | The job: loads what is due, builds the message, **claims the day's slot in `push_deliveries` before sending**, sends, forgets devices the push service reports gone, releases the slot on a transient failure. |
| `index.ts`                    | The Edge Function entry: checks the shared secret, wires in the service-role client and Web Push (VAPID).                                                                                                      |

- **Prep day** is the day a prep session is planned for (the plan's own `prep_date`, so a session
  moved to Saturday reminds on Saturday). It is sent only when that session still has unfinished
  tasks: "5 tasks to get ahead of the week — about 1 hr 15 min".
- **Tonight's dinner** is sent only when a dinner is planned for the person's local today, titled
  the way they see it (their personal version's title wins). One dinner opens straight into cook
  mode; several open the week.
- At most **one notification per person, kind and local day**, however often the job runs or
  overlaps.

## Deploy

```bash
# 1. VAPID keys (once). The PUBLIC key also goes in the app as NEXT_PUBLIC_VAPID_PUBLIC_KEY.
pnpm vapid:keys

# 2. Secrets for the function
supabase secrets set \
  REMINDERS_CRON_SECRET="$(openssl rand -hex 32)" \
  VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… \
  VAPID_SUBJECT=mailto:you@example.com

# 3. Deploy (the gateway's JWT check is off; the shared secret is the way in)
supabase functions deploy send-reminders --no-verify-jwt

# 4. Schedule it: run supabase/cron/send-reminders.sql in the SQL editor
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically.

## Try it

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-reminders" \
  -H "Authorization: Bearer $REMINDERS_CRON_SECRET"
# → {"recipients":12,"due":3,"quiet":1,"already":0,"sent":2,"failed":0,"retrying":0,"removedDevices":0}
```

The response only ever contains counts. Tests: `pnpm test tests/reminders` (rules, and the whole job
against a real Postgres with the sender replaced by a recorder).
