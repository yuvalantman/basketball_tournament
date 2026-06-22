-- =============================================================================
-- Hoops Tournament — full database schema, RLS, and helpers.
-- Paste this whole file into the Supabase SQL editor (or run via the CLI).
-- Safe to re-run: it drops/recreates policies and uses IF NOT EXISTS.
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
  username    text unique not null,
  display_name text not null,
  height_cm   numeric,
  weight_kg   numeric,
  photo_url   text,
  created_at  timestamptz not null default now()
);

create table if not exists public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  creator_id      uuid not null references public.profiles (id) on delete cascade,
  rating_mode     text not null default 'eight' check (rating_mode in ('eight','single')),
  stats_visibility text not null default 'creator_only'
                    check (stats_visibility in ('creator_only','everyone','radar_normalized')),
  team_size       int not null default 3 check (team_size in (2,3,5)),
  status          text not null default 'lobby'
                    check (status in ('lobby','rating','teams','bracket','done')),
  created_at      timestamptz not null default now()
);

create table if not exists public.tournament_players (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  joined_at     timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

-- Peer ratings. ANONYMOUS: RLS only ever exposes a rater their OWN rows.
-- Aggregates are computed server-side with the service role.
create table if not exists public.ratings (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  rater_id      uuid not null references public.profiles (id) on delete cascade,
  ratee_id      uuid not null references public.profiles (id) on delete cascade,
  shooting      int check (shooting between 1 and 5),
  scoring       int check (scoring between 1 and 5),
  dribbling     int check (dribbling between 1 and 5),
  rebounding    int check (rebounding between 1 and 5),
  passing       int check (passing between 1 and 5),
  defending     int check (defending between 1 and 5),
  physicality   int check (physicality between 1 and 5),
  athleticism   int check (athleticism between 1 and 5),
  single_score  int check (single_score between 1 and 10),
  updated_at    timestamptz not null default now(),
  primary key (tournament_id, rater_id, ratee_id),
  check (rater_id <> ratee_id)
);

create table if not exists public.restrictions (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_a      uuid not null references public.profiles (id) on delete cascade,
  player_b      uuid not null references public.profiles (id) on delete cascade,
  unique (tournament_id, player_a, player_b)
);

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null,
  seed          int not null default 0
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (team_id, user_id)
);

create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  stage          text not null check (stage in ('group','bracket')),
  round          int not null default 0,
  slot           int not null default 0,
  team_a         uuid references public.teams (id) on delete set null,
  team_b         uuid references public.teams (id) on delete set null,
  score_a        int,
  score_b        int,
  winner_team_id uuid references public.teams (id) on delete set null,
  next_game_id   uuid references public.games (id) on delete set null,
  next_slot      text check (next_slot in ('a','b')),
  loser_game_id  uuid references public.games (id) on delete set null,
  loser_slot     text check (loser_slot in ('a','b'))
);

create index if not exists idx_tp_user on public.tournament_players (user_id);
create index if not exists idx_ratings_tournament on public.ratings (tournament_id);
create index if not exists idx_teams_tournament on public.teams (tournament_id);
create index if not exists idx_games_tournament on public.games (tournament_id);

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so RLS policies can check membership
-- without recursing into the very tables they protect).
-- -----------------------------------------------------------------------------

create or replace function public.is_tournament_member(t uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.tournament_players
    where tournament_id = t and user_id = auth.uid()
  );
$$;

create or replace function public.is_tournament_creator(t uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.tournaments
    where id = t and creator_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.tournaments         enable row level security;
alter table public.tournament_players  enable row level security;
alter table public.ratings             enable row level security;
alter table public.restrictions        enable row level security;
alter table public.teams               enable row level security;
alter table public.team_members        enable row level security;
alter table public.games               enable row level security;

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

-- tournaments: members can read; anyone can create (as themselves);
-- only the creator can update settings/status.
drop policy if exists tournaments_select on public.tournaments;
create policy tournaments_select on public.tournaments
  for select to authenticated
  using (creator_id = auth.uid() or public.is_tournament_member(id));

drop policy if exists tournaments_insert on public.tournaments;
create policy tournaments_insert on public.tournaments
  for insert to authenticated with check (creator_id = auth.uid());

drop policy if exists tournaments_update on public.tournaments;
create policy tournaments_update on public.tournaments
  for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());

-- tournament_players: members can see the roster; you can add yourself.
drop policy if exists tp_select on public.tournament_players;
create policy tp_select on public.tournament_players
  for select to authenticated using (public.is_tournament_member(tournament_id));

drop policy if exists tp_insert on public.tournament_players;
create policy tp_insert on public.tournament_players
  for insert to authenticated with check (user_id = auth.uid());

-- ratings: ANONYMOUS. You can only ever see / write your OWN ratings.
-- (Aggregates come from the service role, never from client SELECTs.)
drop policy if exists ratings_select_own on public.ratings;
create policy ratings_select_own on public.ratings
  for select to authenticated using (rater_id = auth.uid());

drop policy if exists ratings_insert_own on public.ratings;
create policy ratings_insert_own on public.ratings
  for insert to authenticated
  with check (rater_id = auth.uid() and public.is_tournament_member(tournament_id));

drop policy if exists ratings_update_own on public.ratings;
create policy ratings_update_own on public.ratings
  for update to authenticated
  using (rater_id = auth.uid()) with check (rater_id = auth.uid());

-- restrictions: members read, creator manages.
drop policy if exists restrictions_select on public.restrictions;
create policy restrictions_select on public.restrictions
  for select to authenticated using (public.is_tournament_member(tournament_id));

drop policy if exists restrictions_write on public.restrictions;
create policy restrictions_write on public.restrictions
  for all to authenticated
  using (public.is_tournament_creator(tournament_id))
  with check (public.is_tournament_creator(tournament_id));

-- teams / team_members: members read. Writes happen via the service role
-- during generation, so no client write policy is needed.
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated using (public.is_tournament_member(tournament_id));

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (exists (
    select 1 from public.teams tm
    where tm.id = team_id and public.is_tournament_member(tm.tournament_id)
  ));

-- games: members read; creator can update scores. Inserts via service role.
drop policy if exists games_select on public.games;
create policy games_select on public.games
  for select to authenticated using (public.is_tournament_member(tournament_id));

drop policy if exists games_update on public.games;
create policy games_update on public.games
  for update to authenticated
  using (public.is_tournament_creator(tournament_id))
  with check (public.is_tournament_creator(tournament_id));

-- -----------------------------------------------------------------------------
-- Storage bucket for profile photos
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

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
-- Realtime: publish the tables the app subscribes to for live updates
-- (roster joins, status changes, teams, games, restrictions). RLS still
-- applies — subscribers only receive changes to rows they're allowed to read.
-- Ratings are intentionally NOT published (they're private/anonymous).
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'tournaments',
    'tournament_players',
    'teams',
    'team_members',
    'games',
    'restrictions'
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
