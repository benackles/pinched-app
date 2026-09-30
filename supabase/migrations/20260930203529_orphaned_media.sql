-- Files in the recipe-media bucket that no recipe_media row points at.
--
-- Photos and video are uploaded straight from the browser to Storage and only then attached to the
-- recipe. A tab closed in between, a failed "attach", or a removal Storage never completed leaves a
-- file nobody can see or delete. The cleanup job asks this function which files those are and
-- removes them through the Storage API (deleting rows from storage.objects alone would leave the
-- bytes behind).
--
-- Only files older than p_min_age are listed, so an upload that is still on its way to being
-- attached is never touched. Oldest first, at most 1000 per call; the job runs daily and loops.
-- (Two columns on purpose, so the API always answers with a list of objects.)
-- Service role only — never callable from the client.

CREATE OR REPLACE FUNCTION public.orphaned_media_objects(p_min_age interval DEFAULT interval '1 day')
RETURNS TABLE (name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name, o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'recipe-media'
    AND o.created_at < now() - p_min_age
    AND NOT EXISTS (SELECT 1 FROM public.recipe_media m WHERE m.storage_path = o.name)
  ORDER BY o.created_at
  LIMIT 1000;
$$;

REVOKE ALL ON FUNCTION public.orphaned_media_objects(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphaned_media_objects(interval) TO service_role;
