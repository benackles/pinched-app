-- Private bucket for user photos and video.
-- Objects live in a per-user folder: <clerk user id>/<recipe id>/<file>. The policies compare the
-- first path segment to the JWT subject, so one person can never read or write another's media.
-- Uploads go browser → Storage through signed upload URLs minted (under RLS) by the server.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recipe-media',
  'recipe-media',
  false,
  104857600,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "recipe-media: read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'recipe-media'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY "recipe-media: upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recipe-media'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY "recipe-media: update own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'recipe-media'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
  )
  WITH CHECK (
    bucket_id = 'recipe-media'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY "recipe-media: delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'recipe-media'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
  );
