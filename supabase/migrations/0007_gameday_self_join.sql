-- =============================================================================
-- Self-service gameday joining, opt-in per gameday via a new nullable
-- max_players cap. A gameday with max_players unset behaves EXACTLY as
-- before (manager-only add, waitlist-only self-service) — nothing changes
-- unless a manager explicitly sets a cap when creating the gameday.
--
-- Capacity enforcement cannot live in RLS: every write to
-- gameday_participants/gameday_waitlist already goes through the
-- service-role admin client in server actions (no RLS write policies exist
-- on these tables at all). And it can't be done as two separate
-- Supabase-JS calls ("select count() then insert") either — that has a real
-- race: two people clicking Join at nearly the same instant could both read
-- "1 slot free" and both insert, overbooking the game. So the whole
-- check-and-decide-and-insert has to happen atomically in ONE Postgres
-- function, under a row lock on the specific gameday (not table-wide) so
-- concurrent joins on OTHER gamedays are completely unaffected.
-- =============================================================================

begin;

alter table public.gamedays
  add column if not exists max_players int null check (max_players is null or max_players > 0);

-- New display_options key (group strength visible to regular members, off
-- by default) — backfill it onto existing groups explicitly so their stored
-- JSON matches new ones exactly. Not strictly required (app code treats a
-- missing key as false), but keeps the data consistent.
update public.groups
set display_options = display_options || '{"group_strength": false}'::jsonb
where not (display_options ? 'group_strength');

-- Atomic join: the `for update` lock below serializes concurrent joins for
-- THIS gameday only — the second caller always re-reads a fresh count after
-- the first transaction commits, so gameday_participants can never exceed
-- max_players, and near-simultaneous joiners resolve in true commit order
-- (i.e. first-arrived-wins).
create or replace function public.join_gameday(p_gameday_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_players int;
  v_participant_count int;
  v_waitlist_position int;
begin
  select max_players into v_max_players
  from public.gamedays where id = p_gameday_id for update;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'gameday_not_found');
  end if;
  if v_max_players is null then
    return jsonb_build_object('status', 'error', 'message', 'self_join_disabled');
  end if;

  if exists (select 1 from public.gameday_participants
             where gameday_id = p_gameday_id and kind = 'member' and participant_id = p_user_id) then
    return jsonb_build_object('status', 'already_in');
  end if;

  if exists (select 1 from public.gameday_waitlist
             where gameday_id = p_gameday_id and user_id = p_user_id) then
    select count(*) + 1 into v_waitlist_position
    from public.gameday_waitlist
    where gameday_id = p_gameday_id
      and added_at < (select added_at from public.gameday_waitlist
                       where gameday_id = p_gameday_id and user_id = p_user_id);
    return jsonb_build_object('status', 'already_waitlisted', 'position', v_waitlist_position);
  end if;

  select count(*) into v_participant_count
  from public.gameday_participants where gameday_id = p_gameday_id;

  if v_participant_count < v_max_players then
    insert into public.gameday_participants (gameday_id, kind, participant_id)
    values (p_gameday_id, 'member', p_user_id);
    return jsonb_build_object('status', 'joined');
  else
    insert into public.gameday_waitlist (gameday_id, user_id) values (p_gameday_id, p_user_id);
    select count(*) into v_waitlist_position
    from public.gameday_waitlist where gameday_id = p_gameday_id;
    return jsonb_build_object('status', 'waitlisted', 'position', v_waitlist_position);
  end if;
end;
$$;

-- Atomic self-leave, mirroring app/actions/gameday.ts's existing
-- removeParticipant (same team-slot-vacate + waitlist-head-promotion logic,
-- just self-service and lock-protected instead of manager-only).
create or replace function public.leave_gameday(p_gameday_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vacated_team_id uuid;
  v_vacated_reserve boolean;
  v_promoted_user_id uuid;
begin
  perform 1 from public.gamedays where id = p_gameday_id for update;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'gameday_not_found');
  end if;

  delete from public.gameday_waitlist where gameday_id = p_gameday_id and user_id = p_user_id;
  if found then
    return jsonb_build_object('status', 'left_waitlist');
  end if;

  select tm.team_id, tm.is_reserve into v_vacated_team_id, v_vacated_reserve
  from public.team_members tm join public.teams t on t.id = tm.team_id
  where t.gameday_id = p_gameday_id and tm.kind = 'member' and tm.participant_id = p_user_id
  limit 1;
  if v_vacated_team_id is not null then
    delete from public.team_members
    where team_id = v_vacated_team_id and kind = 'member' and participant_id = p_user_id;
  end if;

  delete from public.gameday_participants
  where gameday_id = p_gameday_id and kind = 'member' and participant_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_in_gameday');
  end if;

  select user_id into v_promoted_user_id
  from public.gameday_waitlist where gameday_id = p_gameday_id
  order by added_at asc limit 1;

  if v_promoted_user_id is not null then
    delete from public.gameday_waitlist where gameday_id = p_gameday_id and user_id = v_promoted_user_id;
    insert into public.gameday_participants (gameday_id, kind, participant_id)
    values (p_gameday_id, 'member', v_promoted_user_id)
    on conflict (gameday_id, kind, participant_id) do nothing;
    if v_vacated_team_id is not null then
      insert into public.team_members (team_id, kind, participant_id, is_reserve)
      values (v_vacated_team_id, 'member', v_promoted_user_id, v_vacated_reserve);
    end if;
  end if;

  return jsonb_build_object('status', 'left_participants', 'promoted_user_id', v_promoted_user_id);
end;
$$;

revoke all on function public.join_gameday(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_gameday(uuid, uuid) from public, anon, authenticated;

commit;
