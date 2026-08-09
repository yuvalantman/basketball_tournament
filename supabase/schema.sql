-- =============================================================================
-- Hoops — full database schema, RLS, and helpers (multi-sport groups model).
-- Paste this whole file into the Supabase SQL editor (or run via the CLI).
-- Safe to re-run: it drops/recreates policies and uses IF NOT EXISTS.
--
-- For an EXISTING live project already running the old (tournament-model)
-- schema, do NOT run this file directly — run
-- supabase/migrations/0002_to_groups_multisport.sql instead, which
-- transforms the live data in place. This file is for fresh installs only.
-- =============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- One row per user, linked to auth.users. Username/password auth maps each
-- username to a synthetic email under the hood; the username lives here.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  -- Format enforced at the DB level too (matches lib/username.ts's
  -- isValidUsername regex) — the JS check alone can be bypassed by a direct
  -- API call, and this format feeds the username->login-email resolution.
  username    text unique not null check (username ~ '^[a-z0-9_]{2,20}$'),
  display_name text not null,
  gender      text check (gender in ('M','F')),
  height_cm   numeric,
  weight_kg   numeric,
  photo_url   text,
  -- Real personal email, used as this account's actual Supabase auth email
  -- (collected at signup) so "forgot password" can deliver a reset link.
  -- Not unique/not-null — legacy/imported rows may have none yet.
  email       text,
  created_at  timestamptz not null default now()
);

-- A persistent group of players for one sport. Rating never closes; team
-- size/format live per-gameday, not here. `sport` is immutable after
-- creation (enforced in the app layer, not by a DB trigger).
create table if not exists public.groups (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  sport           text not null check (sport in ('basketball','soccer','volleyball')),
  creator_id      uuid not null references public.profiles (id) on delete cascade,
  display_options jsonb not null default '{
    "averages": false, "radar": false, "overall": true,
    "best_worst": false, "archetype": false
  }'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists public.group_players (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Manager-granted rating power: this member's own (source='normal) ratings
  -- of others count `rating_weight`x in the weighted average, instead of the
  -- default 1x. Distinct from ratings.weight/source below, which power a
  -- separate feature (the manager's own one-off weighted rating of someone).
  rating_weight smallint not null default 1 check (rating_weight in (1,2,3)),
  primary key (group_id, user_id)
);

-- Peer ratings, scoped to one group, persistent (rating never closes).
-- ANONYMOUS: RLS only ever exposes a rater their OWN rows. Aggregates are
-- computed server-side with the service role.
--
-- `values` is a sparse jsonb map of ONLY the attributes actually rated, e.g.
-- {"overall": 8, "spiking": 4} — a cleared attribute is removed from the
-- object entirely, never stored as a null. Keys are validated against the
-- group's sport's attribute list in the app layer (lib/sports.ts), not here.
--
-- `weight` / `source` implement the manager-weighted-rating feature: a
-- normal self-service rating is always weight=1, source='normal' (enforced
-- by the INSERT/UPDATE policy's WITH CHECK below, so a client can never
-- forge a higher weight). Only a server action using the service-role
-- admin client — after re-verifying the caller is the group's owner — can
-- write weight>1, source='manager'.
create table if not exists public.ratings (
  group_id   uuid not null references public.groups (id) on delete cascade,
  rater_id   uuid not null references public.profiles (id) on delete cascade,
  ratee_id   uuid not null references public.profiles (id) on delete cascade,
  values     jsonb not null default '{}'::jsonb,
  weight     smallint not null default 1 check (weight in (1,2,3,5)),
  source     text not null default 'normal' check (source in ('normal','manager')),
  updated_at timestamptz not null default now(),
  primary key (group_id, rater_id, ratee_id),
  check (rater_id <> ratee_id)
);

-- A single ad-hoc event within a group: pick who's coming, balance teams,
-- play, then it expires. No status column — "have teams been generated?"
-- is simply "do rows exist in `teams` for this gameday."
create table if not exists public.gamedays (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  date       date not null,
  team_size  int not null check (team_size between 2 and 11),
  created_at timestamptz not null default now()
);

-- A one-off, non-member player added to a single gameday. Ephemeral: not a
-- group member, never rated by anyone but the gameday creator, deleted
-- entirely (cascade) when the gameday is deleted or expires.
create table if not exists public.gameday_guests (
  id         uuid primary key default gen_random_uuid(),
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  name       text not null,
  gender     text check (gender in ('M','F')),
  height_cm  numeric,
  photo_url  text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The ONE rating a guest ever gets, from the gameday creator who added them.
-- Deliberately separate from `ratings` (not a rater/ratee pair — exactly one
-- rater, ephemeral, no cross-rater aggregation needed).
create table if not exists public.gameday_guest_ratings (
  guest_id   uuid primary key references public.gameday_guests (id) on delete cascade,
  rated_by   uuid not null references public.profiles (id) on delete cascade,
  values     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The active player pool for a gameday — members AND guests, polymorphic by
-- `kind`. Integrity (that participant_id actually refers to a row belonging
-- to this gameday's group) is enforced in the server actions, the same
-- app-layer-invariant convention this schema already uses for anonymity.
create table if not exists public.gameday_participants (
  gameday_id     uuid not null references public.gamedays (id) on delete cascade,
  kind           text not null check (kind in ('member','guest')),
  participant_id uuid not null,
  added_at       timestamptz not null default now(),
  primary key (gameday_id, kind, participant_id)
);

-- Ordered waiting list (group members only — guests are never waitlisted,
-- they're added directly). Position = order by added_at; "shift up" after a
-- promotion is free (just delete the promoted row).
create table if not exists public.gameday_waitlist (
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (gameday_id, user_id)
);

-- "Must be together" / "can't be together" pairs, scoped to one gameday
-- (was group-level `restrictions` in v1). Polymorphic on both sides so a
-- guest can be paired/restricted against a member or another guest.
create table if not exists public.gameday_restrictions (
  id         uuid primary key default gen_random_uuid(),
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  kind       text not null default 'apart' check (kind in ('apart','together')),
  a_kind     text not null check (a_kind in ('member','guest')),
  a_id       uuid not null,
  b_kind     text not null check (b_kind in ('member','guest')),
  b_id       uuid not null,
  unique (gameday_id, kind, a_kind, a_id, b_kind, b_id)
);

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  name       text not null,
  seed       int not null default 0
);

-- Polymorphic team membership + a reserve flag: when a gameday's player
-- count doesn't divide evenly by team_size, extra players are distributed
-- across teams as reserves. Balance math already averages per-team (not
-- sums), so this flag is purely cosmetic — it doesn't change the balancing
-- calculation, only which names get a "Reserve" badge in the UI.
create table if not exists public.team_members (
  team_id        uuid not null references public.teams (id) on delete cascade,
  kind           text not null check (kind in ('member','guest')),
  participant_id uuid not null,
  is_reserve     boolean not null default false,
  primary key (team_id, kind, participant_id)
);

create index if not exists idx_group_players_user   on public.group_players (user_id);
create index if not exists idx_ratings_group        on public.ratings (group_id);
create index if not exists idx_ratings_group_ratee  on public.ratings (group_id, ratee_id);
create index if not exists idx_gamedays_group       on public.gamedays (group_id);
create index if not exists idx_guests_gameday       on public.gameday_guests (gameday_id);
create index if not exists idx_participants_gameday on public.gameday_participants (gameday_id);
create index if not exists idx_waitlist_gameday     on public.gameday_waitlist (gameday_id, added_at);
create index if not exists idx_restrictions_gameday on public.gameday_restrictions (gameday_id);
create index if not exists idx_teams_gameday        on public.teams (gameday_id);

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so RLS policies can check membership
-- without recursing into the very tables they protect).
-- -----------------------------------------------------------------------------

create or replace function public.is_group_member(g uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_players
    where group_id = g and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_owner(g uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.groups
    where id = g and creator_id = auth.uid()
  );
$$;

create or replace function public.gameday_group_id(gd uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select group_id from public.gamedays where id = gd;
$$;

create or replace function public.is_gameday_group_member(gd uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_group_member(public.gameday_group_id(gd));
$$;

-- Gameday's own creator, OR the group's owner — the two roles allowed to
-- manage a gameday (delete it, edit its restrictions/teams/waitlist).
create or replace function public.is_gameday_manager(gd uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.gamedays d
    where d.id = gd
      and (d.creator_id = auth.uid() or public.is_group_owner(d.group_id))
  );
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.groups                enable row level security;
alter table public.group_players         enable row level security;
alter table public.ratings               enable row level security;
alter table public.gamedays              enable row level security;
alter table public.gameday_guests        enable row level security;
alter table public.gameday_guest_ratings enable row level security;
alter table public.gameday_participants  enable row level security;
alter table public.gameday_waitlist      enable row level security;
alter table public.gameday_restrictions  enable row level security;
alter table public.teams                 enable row level security;
alter table public.team_members          enable row level security;

-- profiles: any logged-in user can read profiles (needed to show rosters);
-- you may only write your own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- groups: members can read; anyone can create (as themselves);
-- only the owner can update settings (name/display_options — `sport` is
-- immutable, simply never accepted in the update server action's patch).
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (creator_id = auth.uid() or public.is_group_member(id));

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups
  for insert to authenticated with check (creator_id = auth.uid());

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete to authenticated using (creator_id = auth.uid());

-- group_players: members can see the roster; you can add yourself (join is
-- always allowed, there's no closed "lobby" phase anymore).
drop policy if exists gp_select on public.group_players;
create policy gp_select on public.group_players
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists gp_insert on public.group_players;
create policy gp_insert on public.group_players
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists gp_delete on public.group_players;
create policy gp_delete on public.group_players
  for delete to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id));

-- ratings: ANONYMOUS. You can only ever see / write your OWN ratings, and
-- only ever as a normal-weight, normal-source row — this is also the
-- weight-forgery-proof boundary (see column comments above).
drop policy if exists ratings_select_own on public.ratings;
create policy ratings_select_own on public.ratings
  for select to authenticated using (rater_id = auth.uid());

drop policy if exists ratings_insert_own on public.ratings;
create policy ratings_insert_own on public.ratings
  for insert to authenticated
  with check (
    rater_id = auth.uid()
    and public.is_group_member(group_id)
    and weight = 1
    and source = 'normal'
  );

drop policy if exists ratings_update_own on public.ratings;
create policy ratings_update_own on public.ratings
  for update to authenticated
  using (rater_id = auth.uid())
  with check (rater_id = auth.uid() and weight = 1 and source = 'normal');

-- gamedays: any group member can read/create. Deletes need creator-or-owner,
-- checked here AND re-checked in the server action for defense in depth.
drop policy if exists gamedays_select on public.gamedays;
create policy gamedays_select on public.gamedays
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists gamedays_insert on public.gamedays;
create policy gamedays_insert on public.gamedays
  for insert to authenticated
  with check (creator_id = auth.uid() and public.is_group_member(group_id));

drop policy if exists gamedays_delete on public.gamedays;
create policy gamedays_delete on public.gamedays
  for delete to authenticated using (public.is_gameday_manager(id));

-- gameday_guests / gameday_guest_ratings: group members read; writes go
-- through server actions using the admin client (guest creation always
-- requires the caller to be the gameday's creator, re-checked server-side).
drop policy if exists guests_select on public.gameday_guests;
create policy guests_select on public.gameday_guests
  for select to authenticated using (public.is_gameday_group_member(gameday_id));

drop policy if exists guest_ratings_select on public.gameday_guest_ratings;
create policy guest_ratings_select on public.gameday_guest_ratings
  for select to authenticated
  using (exists (
    select 1 from public.gameday_guests g
    where g.id = guest_id and public.is_gameday_group_member(g.gameday_id)
  ));

-- gameday_participants / gameday_waitlist / gameday_restrictions / teams /
-- team_members: members read; all writes via the service role in server
-- actions (each individually re-checks "is this the gameday creator, the
-- group owner, or — for self-service waitlist actions — the user
-- themselves"), same philosophy as v1's teams/games tables.
drop policy if exists participants_select on public.gameday_participants;
create policy participants_select on public.gameday_participants
  for select to authenticated using (public.is_gameday_group_member(gameday_id));

drop policy if exists waitlist_select on public.gameday_waitlist;
create policy waitlist_select on public.gameday_waitlist
  for select to authenticated using (public.is_gameday_group_member(gameday_id));

drop policy if exists restrictions_select on public.gameday_restrictions;
create policy restrictions_select on public.gameday_restrictions
  for select to authenticated using (public.is_gameday_group_member(gameday_id));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated using (public.is_gameday_group_member(gameday_id));

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (exists (
    select 1 from public.teams tm
    where tm.id = team_id and public.is_gameday_group_member(tm.gameday_id)
  ));

-- -----------------------------------------------------------------------------
-- Storage bucket for profile photos (also used for gameday guest photos,
-- uploaded under the creating member's own uid folder since guests have no
-- auth.users row of their own).
-- -----------------------------------------------------------------------------

-- file_size_limit (bytes) and allowed_mime_types are enforced by Supabase
-- Storage itself on every upload — defense in depth beyond the upload form's
-- client-side accept="image/*" hint, which a direct API call could bypass.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can view avatars (public bucket); authenticated users can upload/manage
-- files under a folder named after their own user id (e.g. <uid>/photo.jpg).
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- Realtime: publish the tables the app subscribes to for live updates.
-- RLS still applies — subscribers only receive changes to rows they're
-- allowed to read. Ratings (and gameday_guest_ratings) are intentionally
-- NOT published — they're private/anonymous.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'groups',
    'group_players',
    'gamedays',
    'gameday_participants',
    'gameday_waitlist',
    'gameday_guests',
    'gameday_restrictions',
    'teams',
    'team_members'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null; -- already published, ignore
      when undefined_object then
        -- publication doesn't exist on this instance; create it then retry
        execute 'create publication supabase_realtime';
        execute format('alter publication supabase_realtime add table public.%I', t);
    end;
  end loop;
end $$;
