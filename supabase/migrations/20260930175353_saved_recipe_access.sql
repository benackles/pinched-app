-- Catalog visibility follow-up.
--
-- 1. has_saved_recipe(): lets the recipes policy say "or you saved it" without reading
--    saved_recipes inline (saved_recipes' insert policy reads recipes, so an inline reference
--    would make the two policies recurse). SECURITY DEFINER, but it only ever answers for the
--    signed-in user's own saved rows.
-- 2. saved_recipes.recipe_id (and user_id) become immutable to clients, so a saved row cannot be
--    re-pointed at a recipe the person could not save in the first place.
--
-- The policies that use these are in the next migration (generated from src/db/schema.ts).

CREATE OR REPLACE FUNCTION public.has_saved_recipe(p_recipe_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.saved_recipes s
    WHERE s.recipe_id = p_recipe_id
      AND s.user_id = (auth.jwt() ->> 'sub')
  );
$$;

REVOKE ALL ON FUNCTION public.has_saved_recipe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_saved_recipe(uuid) TO authenticated, service_role;

-- Only a favourite flag and a personal rating are editable after saving.
REVOKE UPDATE ON public.saved_recipes FROM authenticated;
GRANT UPDATE (favorite, personal_rating) ON public.saved_recipes TO authenticated;
