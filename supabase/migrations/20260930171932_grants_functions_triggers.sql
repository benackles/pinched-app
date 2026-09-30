-- Grants, entitlement functions, free-tier triggers and usage counters.
--
-- RLS (previous migration) decides WHICH ROWS a user can touch. The grants below decide which
-- OPERATIONS exist at all. They are explicit because newer Supabase projects no longer expose
-- new tables to the Data API automatically.

-- ─────────────────────────────── privileges ───────────────────────────────

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.recipes,
  public.ingredients,
  public.recipe_steps,
  public.recipe_media,
  public.saved_recipes,
  public.recipe_modifications,
  public.recipe_notes,
  public.collections,
  public.collection_items,
  public.kitchen_items,
  public.weekly_plans,
  public.planned_meals,
  public.grocery_lists,
  public.grocery_list_items,
  public.grocery_item_sources,
  public.prep_plans,
  public.prep_tasks,
  public.prep_task_meals,
  public.cooking_events,
  public.push_subscriptions
TO authenticated;

-- Append-only from the client.
GRANT SELECT, INSERT ON public.prep_edit_log TO authenticated;

-- Read-only from the client: written by the Stripe webhook / increment_usage().
GRANT SELECT ON public.subscriptions, public.usage_counters TO authenticated;

-- Profiles: people edit their own preferences, but never the Stripe customer id (the billing
-- portal is opened for that id) or the email mirrored from Clerk.
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT (user_id, email, name, prep_day, reminder_time, timezone, remind_prep, remind_dinner)
  ON public.profiles TO authenticated;
GRANT UPDATE (name, prep_day, reminder_time, timezone, remind_prep, remind_dinner)
  ON public.profiles TO authenticated;

-- Jobs and webhooks run as the service role (server-side only; the key never ships to the client).
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- ─────────────────────────────── entitlement ───────────────────────────────

-- Pro = an active, trialing or past-due subscription (past_due keeps access while Stripe retries the card).
CREATE OR REPLACE FUNCTION public.user_is_pro(p_user_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('trialing', 'active', 'past_due')
      AND (s.current_period_end IS NULL OR s.current_period_end > now() - interval '3 days')
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_pro(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_pro(text) TO service_role;

-- What the app calls: only ever answers for the signed-in user.
CREATE OR REPLACE FUNCTION public.is_pro()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_is_pro(auth.jwt() ->> 'sub');
$$;

REVOKE ALL ON FUNCTION public.is_pro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_pro() TO authenticated, service_role;

-- ─────────────────────────────── usage counters ───────────────────────────────

-- Atomically bumps a counter for the signed-in user and rejects the call once p_limit is
-- exceeded (the raise rolls the increment back). Clients cannot write usage_counters directly,
-- so a free-tier quota cannot be reset from the browser.
CREATE OR REPLACE FUNCTION public.increment_usage(p_key text, p_limit integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid text := auth.jwt() ->> 'sub';
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.usage_counters AS u (user_id, key, count)
  VALUES (uid, p_key, 1)
  ON CONFLICT (user_id, key)
  DO UPDATE SET count = u.count + 1, updated_at = now()
  RETURNING u.count INTO n;

  IF p_limit IS NOT NULL AND n > p_limit THEN
    RAISE EXCEPTION 'limit_exceeded:%', p_key USING ERRCODE = 'P0001';
  END IF;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_usage(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_usage(text, integer) TO authenticated, service_role;

-- ─────────────────────────────── free-tier limits ───────────────────────────────

-- The server checks these first for a friendly upgrade prompt; the triggers make the limits
-- tamper-proof even for someone calling the REST API directly with their own session token.
-- Keep the numbers in sync with FREE_LIMITS in src/lib/domain/constants.ts (a unit test enforces it).
CREATE OR REPLACE FUNCTION public.enforce_free_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  -- Only ever count against the caller's own rows. A row addressed to someone else is left for
  -- RLS to reject uniformly, so the error code can't reveal another user's usage.
  IF (auth.jwt() ->> 'sub') IS NOT NULL AND NEW.user_id IS DISTINCT FROM (auth.jwt() ->> 'sub') THEN
    RETURN NEW;
  END IF;

  IF public.user_is_pro(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'saved_recipes' THEN
    SELECT count(*) INTO n FROM public.saved_recipes WHERE user_id = NEW.user_id;
    IF n >= 25 THEN
      RAISE EXCEPTION 'free_limit:saved_recipes' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'prep_plans' THEN
    SELECT count(*) INTO n FROM public.prep_plans WHERE user_id = NEW.user_id;
    IF n >= 2 THEN
      RAISE EXCEPTION 'free_limit:prep_plans' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'recipe_media' THEN
    SELECT count(*) INTO n
    FROM public.recipe_media
    WHERE user_id = NEW.user_id AND recipe_id = NEW.recipe_id;
    IF n >= 1 THEN
      RAISE EXCEPTION 'free_limit:recipe_media' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_free_limit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER saved_recipes_free_limit
  BEFORE INSERT ON public.saved_recipes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_limit();

CREATE TRIGGER prep_plans_free_limit
  BEFORE INSERT ON public.prep_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_limit();

CREATE TRIGGER recipe_media_free_limit
  BEFORE INSERT ON public.recipe_media
  FOR EACH ROW EXECUTE FUNCTION public.enforce_free_limit();

-- ─────────────────────────────── updated_at ───────────────────────────────

-- grocery_list_items and prep_tasks are deliberately excluded: their updated_at carries the
-- client's timestamp so offline check-offs resolve last-write-wins.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER kitchen_items_set_updated_at BEFORE UPDATE ON public.kitchen_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER weekly_plans_set_updated_at BEFORE UPDATE ON public.weekly_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER recipe_modifications_set_updated_at BEFORE UPDATE ON public.recipe_modifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER recipe_notes_set_updated_at BEFORE UPDATE ON public.recipe_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
