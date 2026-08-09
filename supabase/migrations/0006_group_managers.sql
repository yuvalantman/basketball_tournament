-- =============================================================================
-- Lets a group's original creator promote other members to co-manager,
-- without losing their own manager status and without a single point of
-- failure. Co-managers get the same day-to-day authorities as the creator
-- (settings, roster management, rating-weight grants, gameday admin,
-- manager-inspection ratings) — EXCEPT deleting the group entirely, which
-- stays creator-only, and they can never demote or remove the creator.
--
-- The creator's own group_players row does NOT need is_manager=true — every
-- authorization check treats "is the creator" and "is_manager=true" as two
-- equivalent ways to qualify as a manager (see app/actions/_shared.ts's new
-- requireGroupManager). This keeps creator_id as the single, immutable
-- "owner" concept it already was, with is_manager purely additive.
-- =============================================================================

begin;

alter table public.group_players
  add column if not exists is_manager boolean not null default false;

commit;
