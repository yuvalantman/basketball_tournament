-- =============================================================================
-- Adds a real, personal email to profiles for password-reset purposes.
--
-- Background: accounts authenticate with username+password under the hood
-- via a synthetic, never-delivered email (username@<domain>) — see
-- lib/username.ts. That means there was nowhere to actually send a
-- password-reset link. This migration adds a real `email` column; new
-- signups collect it and use it as their ACTUAL Supabase auth email (so
-- Supabase's built-in "forgot password" flow can email them directly, no
-- third-party email service needed). Existing accounts keep working exactly
-- as before (still logging in via their synthetic email) until they add a
-- real email from their Profile page, which is the point they become
-- eligible for password reset.
--
-- Safe to run on top of 0002_to_groups_multisport.sql. Also folded into a
-- fresh supabase/schema.sql for new installs.
-- =============================================================================

begin;

alter table public.profiles add column if not exists email text;

-- Not unique/not-null: legacy rows have no email yet, and it's fine for two
-- different friends to share a household email in a small pickup-groups app.
-- (Login/reset still resolve by username, this is just a delivery address.)

commit;
