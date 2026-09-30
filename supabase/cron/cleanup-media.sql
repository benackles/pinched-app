-- Schedules the orphaned-upload cleanup. Run once per project in the SQL editor, AFTER:
--   1. `supabase functions deploy cleanup-media --no-verify-jwt`
--   2. `supabase secrets set CLEANUP_CRON_SECRET="$(openssl rand -hex 32)"`
--
-- Needs the pg_cron, pg_net and supabase_vault extensions (Database → Extensions).

-- Keep the URL and the shared secret in Vault rather than in the cron command.
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/cleanup-media', 'cleanup_media_function_url');
select vault.create_secret('<the same value as CLEANUP_CRON_SECRET>', 'cleanup_media_cron_secret');

-- Once a day, at a quiet hour (UTC). Only files older than a day that no recipe photo or video
-- points at are removed, so an upload that is still being attached is never touched.
select cron.schedule(
  'cleanup-media',
  '17 4 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_media_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_media_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To stop:   select cron.unschedule('cleanup-media');
-- To check:  select * from cron.job_run_details order by start_time desc limit 10;
--            select id, status_code, content from net._http_response order by created desc limit 10;
-- To see what the next run would remove (service role / SQL editor only):
--            select * from public.orphaned_media_objects();
