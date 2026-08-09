-- =============================================================================
-- Small, targeted security hardening (from an app security review):
--   1. DB-level format constraint on profiles.username — previously only
--      enforced client-side (lib/username.ts's isValidUsername), which a
--      direct API call could bypass. Username feeds the login-email
--      resolution path (app/actions/auth.ts), so a malformed username could
--      break that. Minimum length is 2 (not 3) to match a real existing
--      username in production ("ty") — lib/username.ts's isValidUsername
--      was updated to the same {2,20} range so client/DB stay in sync.
--   2. avatars storage bucket: adds a file-size limit (5MB) and an
--      image-only mime-type allowlist, enforced by Supabase Storage itself
--      on every upload — previously the upload path relied only on the
--      client form's accept="image/*" hint, which a direct API call could
--      bypass to upload arbitrary files into the public bucket.
-- =============================================================================

begin;

alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[a-z0-9_]{2,20}$');

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'avatars';

commit;
