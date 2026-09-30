-- Schedules the reminder job. Run once per project in the SQL editor, AFTER:
--   1. `supabase functions deploy send-reminders --no-verify-jwt`
--   2. `supabase secrets set REMINDERS_CRON_SECRET=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com`
--      (generate the VAPID pair with `pnpm vapid:keys`; the public key also goes in the app's
--      NEXT_PUBLIC_VAPID_PUBLIC_KEY)
--
-- Needs the pg_cron, pg_net and supabase_vault extensions (Database → Extensions).

-- Keep the URL and the shared secret in Vault rather than in the cron command.
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-reminders', 'reminders_function_url');
select vault.create_secret('<the same value as REMINDERS_CRON_SECRET>', 'reminders_cron_secret');

-- Every 10 minutes. A reminder is due from the person's chosen time until an hour later, in their
-- own time zone, and is sent at most once a day (push_deliveries), so the cadence only sets how
-- late a reminder can arrive (up to ~10 minutes).
select cron.schedule(
  'send-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- To stop:   select cron.unschedule('send-reminders');
-- To check:  select * from cron.job_run_details order by start_time desc limit 10;
--            select id, status_code, content from net._http_response order by created desc limit 10;
