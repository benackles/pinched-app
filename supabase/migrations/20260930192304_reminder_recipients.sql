-- Who the reminder job should consider, in one query.
--
-- Push reminders are a Pro feature and strictly opt-in: a person is listed only when they are Pro
-- (the same user_is_pro() that gates everything else), have turned at least one reminder on, and
-- have registered at least one device. The job then works out, in each person's own time zone,
-- whether anything is due right now. Service role only — never callable from the client.

CREATE OR REPLACE FUNCTION public.reminder_recipients()
RETURNS TABLE (
  user_id text,
  timezone text,
  reminder_time time,
  remind_prep boolean,
  remind_dinner boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.timezone, p.reminder_time, p.remind_prep, p.remind_dinner
  FROM public.profiles p
  WHERE (p.remind_prep OR p.remind_dinner)
    AND public.user_is_pro(p.user_id)
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = p.user_id);
$$;

REVOKE ALL ON FUNCTION public.reminder_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reminder_recipients() TO service_role;
