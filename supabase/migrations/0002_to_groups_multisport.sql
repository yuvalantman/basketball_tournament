-- =============================================================================
-- Migration: v1 "tournament" model -> v2 multi-sport "groups + gamedays" model.
--
-- Run this ONCE against the existing LIVE Supabase project (the one with the
-- ~18-user basketball tournament, currently mid-rating, no teams ever
-- generated). It transforms the live data IN PLACE:
--   - the tournament ROW BECOMES a group row (same id) — roster + all
--     ratings survive, reshaped into the new jsonb `values` format.
--   - no teams/games exist yet on the live tournament, so those tables are
--     simply dropped and recreated in the new (gameday-scoped) shape —
--     there is nothing to migrate there.
--
-- SAFETY: back up / duplicate the Supabase project first (or run this
-- against a throwaway copy) before running it on the live project. This
-- entire script is one transaction — it fully applies or fully rolls back,
-- but a real backup is still the safety net for anything outside the DB's
-- own consistency (e.g. if you decide afterward you don't like the result).
--
-- After this runs successfully, deploy the new app build immediately — the
-- OLD build's queries reference tables/columns this script removes.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. profiles: add gender (nullable — existing users set it later from their
--    profile page; new signups require it in the form).
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists gender text check (gender in ('M','F'));

-- -----------------------------------------------------------------------------
-- 1. tournaments -> groups (rename, preserves id/rows), tournament_players ->
--    group_players.
-- -----------------------------------------------------------------------------

alter table public.tournaments        rename to groups;
alter table public.tournament_players rename to group_players;
alter table public.group_players      rename column tournament_id to group_id;

-- -----------------------------------------------------------------------------
-- 2. groups: add sport + display_options, backfill from the old
--    stats_visibility enum, then drop the v1 flow columns that no longer
--    apply at the group level (team size/format now live per-gameday;
--    rating is always open; the live group was always rating_mode='eight',
--    i.e. basketball).
-- -----------------------------------------------------------------------------

alter table public.groups
  add column if not exists sport text not null default 'basketball'
    check (sport in ('basketball','soccer','volleyball')),
  add column if not exists display_options jsonb not null default '{
    "averages": false, "radar": false, "overall": true,
    "best_worst": false, "archetype": false
  }'::jsonb;

update public.groups
set display_options = case stats_visibility
  when 'everyone' then
    '{"averages": true, "radar": true, "overall": true, "best_worst": true, "archetype": true}'::jsonb
  when 'radar_normalized' then
    '{"averages": false, "radar": true, "overall": true, "best_worst": false, "archetype": true}'::jsonb
  else -- 'creator_only'
    '{"averages": false, "radar": false, "overall": false, "best_worst": true, "archetype": true}'::jsonb
end
where stats_visibility is not null;

alter table public.groups
  drop column if exists stats_visibility,
  drop column if exists team_size,
  drop column if exists status,
  drop column if exists rating_mode;

-- -----------------------------------------------------------------------------
-- 3. ratings: tournament_id -> group_id, reshape the 8 hardcoded basketball
--    columns (+ single_score) into a sparse jsonb `values` map, add
--    weight/source for the manager-weighted-rating feature. Every migrated
--    row is a normal (weight=1, source='normal') self-rating. `single_score`
--    is dropped — the live group never used single-score mode (it was
--    always rating_mode='eight'). The new mandatory-per-sport "overall" key
--    will simply be ABSENT from every migrated row for sports that have one
--    — not applicable here since basketball has no mandatory overall field
--    by design (see plan) — so no gap is introduced for this live group.
-- -----------------------------------------------------------------------------

alter table public.ratings rename column tournament_id to group_id;

alter table public.ratings
  add column if not exists values jsonb not null default '{}'::jsonb,
  add column if not exists weight smallint not null default 1 check (weight in (1,2,3,5)),
  add column if not exists source text not null default 'normal' check (source in ('normal','manager'));

update public.ratings
set values = jsonb_strip_nulls(jsonb_build_object(
  'shooting',    shooting,
  'scoring',     scoring,
  'dribbling',   dribbling,
  'rebounding',  rebounding,
  'passing',     passing,
  'defending',   defending,
  'physicality', physicality,
  'athleticism', athleticism
));

alter table public.ratings
  drop column if exists shooting,
  drop column if exists scoring,
  drop column if exists dribbling,
  drop column if exists rebounding,
  drop column if exists passing,
  drop column if exists defending,
  drop column if exists physicality,
  drop column if exists athleticism,
  drop column if exists single_score;

-- -----------------------------------------------------------------------------
-- 4. Drop v1 tables with nothing to migrate (the live group never reached
--    team generation): old group-level restrictions, teams/team_members
--    (tournament-scoped), games (bracket/schedule — dropped entirely, no
--    consumer left in v2; gamedays never build a schedule).
-- -----------------------------------------------------------------------------

drop table if exists public.games cascade;
drop table if exists public.team_members cascade;
drop table if exists public.teams cascade;
drop table if exists public.restrictions cascade;

-- -----------------------------------------------------------------------------
-- 5. New tables for the gameday model (all empty — no gamedays exist yet).
-- -----------------------------------------------------------------------------

create table public.gamedays (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  date       date not null,
  team_size  int not null check (team_size between 2 and 11),
  created_at timestamptz not null default now()
);

create table public.gameday_guests (
  id         uuid primary key default gen_random_uuid(),
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  name       text not null,
  gender     text check (gender in ('M','F')),
  height_cm  numeric,
  photo_url  text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.gameday_guest_ratings (
  guest_id   uuid primary key references public.gameday_guests (id) on delete cascade,
  rated_by   uuid not null references public.profiles (id) on delete cascade,
  values     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.gameday_participants (
  gameday_id     uuid not null references public.gamedays (id) on delete cascade,
  kind           text not null check (kind in ('member','guest')),
  participant_id uuid not null,
  added_at       timestamptz not null default now(),
  primary key (gameday_id, kind, participant_id)
);

create table public.gameday_waitlist (
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (gameday_id, user_id)
);

create table public.gameday_restrictions (
  id         uuid primary key default gen_random_uuid(),
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  kind       text not null default 'apart' check (kind in ('apart','together')),
  a_kind     text not null check (a_kind in ('member','guest')),
  a_id       uuid not null,
  b_kind     text not null check (b_kind in ('member','guest')),
  b_id       uuid not null,
  unique (gameday_id, kind, a_kind, a_id, b_kind, b_id)
);

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  gameday_id uuid not null references public.gamedays (id) on delete cascade,
  name       text not null,
  seed       int not null default 0
);

create table public.team_members (
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
-- 6. Helper functions: rename/replace is_tournament_member/creator with the
--    group/gameday equivalents.
-- -----------------------------------------------------------------------------

-- CASCADE is required here: table renames (section 1) don't touch the old
-- policies still bound to these functions (tournaments_select on `groups`,
-- tp_select on `group_players`, ratings_insert_own on `ratings` — the only
-- three left; every other old policy already vanished with its table in
-- section 4's cascaded drops). Section 7 immediately recreates the correct
-- new policies, so dropping these three old ones here is intentional, not
-- collateral damage.
drop function if exists public.is_tournament_member(uuid) cascade;
drop function if exists public.is_tournament_creator(uuid) cascade;

create or replace function public.is_group_member(g uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.group_players where group_id = g and user_id = auth.uid());
$$;

create or replace function public.is_group_owner(g uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.groups where id = g and creator_id = auth.uid());
$$;

create or replace function public.gameday_group_id(gd uuid)
returns uuid language sql security definer set search_path = public stable as $$
  select group_id from public.gamedays where id = gd;
$$;

create or replace function public.is_gameday_group_member(gd uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_group_member(public.gameday_group_id(gd));
$$;

create or replace function public.is_gameday_manager(gd uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.gamedays d
    where d.id = gd and (d.creator_id = auth.uid() or public.is_group_owner(d.group_id))
  );
$$;

-- -----------------------------------------------------------------------------
-- 7. RLS: drop v1 policies (referencing renamed/dropped tables/columns) and
--    recreate the full v2 policy set (identical to a fresh supabase/schema.sql
--    run — see that file for the authoritative, commented version).
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

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists tournaments_select on public.groups;
drop policy if exists tournaments_insert on public.groups;
drop policy if exists tournaments_update on public.groups;
drop policy if exists groups_select on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
drop policy if exists groups_delete on public.groups;
create policy groups_select on public.groups for select to authenticated using (creator_id = auth.uid() or public.is_group_member(id));
create policy groups_insert on public.groups for insert to authenticated with check (creator_id = auth.uid());
create policy groups_update on public.groups for update to authenticated using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy groups_delete on public.groups for delete to authenticated using (creator_id = auth.uid());

drop policy if exists tp_select on public.group_players;
drop policy if exists tp_insert on public.group_players;
drop policy if exists gp_select on public.group_players;
drop policy if exists gp_insert on public.group_players;
drop policy if exists gp_delete on public.group_players;
create policy gp_select on public.group_players for select to authenticated using (public.is_group_member(group_id));
create policy gp_insert on public.group_players for insert to authenticated with check (user_id = auth.uid());
create policy gp_delete on public.group_players for delete to authenticated using (user_id = auth.uid() or public.is_group_owner(group_id));

drop policy if exists ratings_select_own on public.ratings;
drop policy if exists ratings_insert_own on public.ratings;
drop policy if exists ratings_update_own on public.ratings;
create policy ratings_select_own on public.ratings for select to authenticated using (rater_id = auth.uid());
create policy ratings_insert_own on public.ratings for insert to authenticated
  with check (rater_id = auth.uid() and public.is_group_member(group_id) and weight = 1 and source = 'normal');
create policy ratings_update_own on public.ratings for update to authenticated
  using (rater_id = auth.uid()) with check (rater_id = auth.uid() and weight = 1 and source = 'normal');

create policy gamedays_select on public.gamedays for select to authenticated using (public.is_group_member(group_id));
create policy gamedays_insert on public.gamedays for insert to authenticated with check (creator_id = auth.uid() and public.is_group_member(group_id));
create policy gamedays_delete on public.gamedays for delete to authenticated using (public.is_gameday_manager(id));

create policy guests_select on public.gameday_guests for select to authenticated using (public.is_gameday_group_member(gameday_id));
create policy guest_ratings_select on public.gameday_guest_ratings for select to authenticated
  using (exists (select 1 from public.gameday_guests g where g.id = guest_id and public.is_gameday_group_member(g.gameday_id)));

create policy participants_select on public.gameday_participants for select to authenticated using (public.is_gameday_group_member(gameday_id));
create policy waitlist_select on public.gameday_waitlist for select to authenticated using (public.is_gameday_group_member(gameday_id));
create policy restrictions_select on public.gameday_restrictions for select to authenticated using (public.is_gameday_group_member(gameday_id));
create policy teams_select on public.teams for select to authenticated using (public.is_gameday_group_member(gameday_id));
create policy team_members_select on public.team_members for select to authenticated
  using (exists (select 1 from public.teams tm where tm.id = team_id and public.is_gameday_group_member(tm.gameday_id)));

-- -----------------------------------------------------------------------------
-- 8. Realtime publication: publish the new/renamed tables.
--
-- No explicit "remove the old names" step is needed or possible here:
-- Postgres tracks publication membership by the table's OID, not its name,
-- so renaming `tournaments`->`groups` (section 1) already carried its
-- publication membership over automatically — it shows up as `groups` now.
-- Likewise, `restrictions`/`games` (dropped in section 4) were automatically
-- removed from the publication the moment they were dropped. Trying to
-- `alter publication ... drop table public.tournaments` here would just
-- fail with "relation does not exist" since that name is gone.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'groups','group_players','gamedays','gameday_participants',
    'gameday_waitlist','gameday_guests','gameday_restrictions','teams','team_members'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      -- already a member (true for groups/group_players, carried over from
      -- their pre-rename names) — nothing to do.
      when duplicate_object then null;
      when undefined_object then
        execute 'create publication supabase_realtime';
        execute format('alter publication supabase_realtime add table public.%I', t);
    end;
  end loop;
end $$;

commit;

-- After commit: verify row counts before deploying the new app build, e.g.
--   select count(*) from public.groups;          -- should be 1 (the live group)
--   select count(*) from public.group_players;    -- should match the old roster count
--   select count(*) from public.ratings;          -- should match the old rating count
--   select id, values, weight, source from public.ratings limit 5; -- spot-check reshape
