-- =============================================================================
-- Lets a group's manager grant specific members "extra rating power": their
-- own ratings of other group members count 2x or 3x (instead of the default
-- 1x) in the weighted average.
--
-- This is DIFFERENT from the existing ratings.weight/source columns (added in
-- 0002), which power a separate, already-shipped feature — the manager
-- submitting their OWN one-off weighted "inspection" rating of a player
-- (source='manager'). This migration is about a MEMBER's regular self-service
-- ratings (source stays 'normal') carrying extra weight because the manager
-- granted them that power — a property of the rater, stored on their
-- membership row, not of any single rating submission.
--
-- lib/stats.ts's aggregateRatings() already computes a proper weighted mean
-- (Σ(value·weight)/Σweight) and needs no changes — it already respects
-- whatever `ratings.weight` value is stored, this migration just gives
-- app/actions/rating.ts's upsertRating() a place to look up what weight a
-- given rater should write.
-- =============================================================================

begin;

alter table public.group_players
  add column if not exists rating_weight smallint not null default 1
  check (rating_weight in (1,2,3));

commit;
