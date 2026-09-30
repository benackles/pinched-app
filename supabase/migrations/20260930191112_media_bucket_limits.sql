-- Photos and video: match what the app accepts, and make rows immutable.
--
-- 1. The bucket takes exactly the types the app produces (HEIC is out: browsers can't show it, and
--    iPhones convert to JPEG for the file picker) and no more than 50 MB per file — the smallest
--    upload limit a Supabase project can have, so a video that the app accepts always fits.
-- 2. A media row is only ever added or removed. The update policy was dropped in the previous
--    migration; this removes the privilege as well.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm'
    ],
    file_size_limit = 52428800
WHERE id = 'recipe-media';

REVOKE UPDATE ON public.recipe_media FROM authenticated;
