# Hoops v2 — Groups & Gamedays (Phase 1)

> **Status: PLANNED, not implemented.** This document is a saved blueprint to run
> in a later phase. The app currently still uses the v1 "tournament" model and is
> unchanged. Nothing here has been built yet.

## Context
The app today models a one-shot **tournament**: create → everyone rates once → teams built once → one bracket. The goal is a durable **group** model instead: a group persists, members rate each other continuously, and any member can spin up a **gameday** (pick players, team size, format), play it, then delete it — while the group and all ratings live on. Two more ideas (soccer as a second sport, Hebrew/RTL) are explicitly **deferred to later phases**.

Hard constraint: **the live group (the real tournament with ~18 users) and all its ratings must survive untouched.** It is currently still collecting ratings (no teams generated), which makes migration clean: ratings + roster need **zero data movement** — a tournament simply *becomes* a group (same row/id), since ratings are keyed by `(tournament_id, rater_id, ratee_id)` and membership by `(tournament_id, user_id)`.

v1 (everything before this) is already shipped and working. This plan covers **Phase 1 only**: the groups/gamedays refactor for basketball. Phases 2–3 are outlined at the end.

## Decisions locked with the user
- **Phasing:** Phase 1 = groups+gamedays (basketball) + migrate the live data. Phase 2 = soccer. Phase 3 = Hebrew/RTL.
- **Rating:** always open (no start/close phase). Late joiners rated anytime.
- **Coverage rule:** each player should be rated by ≥ **40%** of the group; a player under 40% is still pickable, filled with **group-average** ratings.
- **Restrictions ("keep apart"):** dropped in v2.
- **Gameday formats (creator picks per gameday):** Smart auto · Single-elim bracket · League→playoffs (creator sets games-per-team) · Just even teams. If players don't divide evenly into the chosen size, form **even teams + a substitutes pool** (leftovers).
- **Gameday rights:** any member creates; the gameday's creator manages/ends it; **multiple gamedays can be open at once**; the **group owner can also end any gameday**.
- **Display/visibility (group owner picks, multi-select, applies group-wide):** independent toggles for ① per-attribute averages ② radar chart ③ single overall score ④ best & worst skill ⑤ archetype. **All member-facing numbers (attribute averages and/or overall) are rendered on a 70–100 scale** (never labeled "normalized"). Ratings stay anonymous; the owner keeps the "who's done" window.
- **Team generation must vary** run-to-run for the same players (not static).

---

## Data model changes
Two SQL artifacts:
1. **`supabase/schema.sql`** — rewritten to the new model (for fresh installs).
2. **`supabase/migrations/0002_to_groups.sql`** — a **single transactional** script that transforms the existing live DB in place (rename + add + backfill). Postgres DDL is transactional, so it fully applies or rolls back.

### Renames (preserve all data)
- `tournaments` → **`groups`**; `tournament_players` → **`group_players`**.
- `ratings.tournament_id` → **`group_id`** (ratings stay at group level — untouched rows).
- Helper fns `is_tournament_member/creator` → **`is_group_member` / `is_group_owner`**.

### `groups` (was tournaments) column changes
- Add `sport text not null default 'basketball'` (soccer arrives in Phase 2).
- Add `display_options jsonb not null default '{...}'` with booleans: `averages, radar, overall, best_worst, archetype`.
- Add `rating_threshold_pct int not null default 40`.
- **Drop the v1 flow columns from group semantics:** `team_size`, `status` are no longer used at group level (team size/format move to gamedays; groups are always "open"). Keep `code`, `name`, `creator_id`, `rating_mode` (basketball stays attribute-based; `single_score` column retained for any legacy rows).
- **Backfill `display_options` from old `stats_visibility`:** `everyone`→all true; `radar_normalized`→{radar,archetype}; `creator_only`→{best_worst,archetype}. Then the old column can be dropped.

### New: `gamedays`
`id, group_id→groups (cascade), creator_id→profiles, name, team_size int, format text check ('auto','knockout','league','teams_only'), league_games int null, created_at`.

### New: `gameday_players`
`(gameday_id, user_id)` — the subset chosen for that gameday. A player in `gameday_players` with **no** `team_members` row after generation = **substitute**.

### `teams` / `games`: move from tournament → gameday
- `teams.tournament_id` → **`gameday_id`** → gamedays (cascade). (No live teams exist, so nothing to migrate.)
- `games.tournament_id` → **`gameday_id`** (cascade). Ending a gameday = `delete from gamedays where id=…` → cascades teams + games.

### Drop
- `restrictions` table (feature removed in v2).

### RLS (same philosophy as v1)
- `groups`/`group_players`: members read; owner writes settings; anyone creates a group / joins.
- `ratings`: unchanged — a rater only ever sees their **own** rows; aggregates only via service role. Anonymity preserved.
- `gamedays`/`gameday_players`/`teams`/`team_members`/`games`: group members read; writes go through server actions (service role) which enforce "gameday creator or group owner".
- Realtime publication: swap to the renamed/new tables (`groups, group_players, gamedays, gameday_players, teams, team_members, games`).

---

## Server actions (`app/actions/*`)
Rework `tournament.ts` → **`group.ts`** + **`gameday.ts`**, reusing existing logic:
- **Group:** `createGroup`, `joinGroup` (always allowed), `updateGroupSettings` (name, `display_options`, threshold), `removePlayer` (owner; reuse existing cleanup, now group-scoped), `getRatingProgress` (owner-only; threshold = `ceil(40% × players)`; reuse the two-direction rated/rated-by logic from v1).
- **Gameday:** `createGameday` (name, selected players → `gameday_players`, team_size, format, league_games), `generateGamedayTeams` (balances **only the selected players**, average-fills under-40% from group aggregates, produces teams + substitutes, **non-deterministic**), `rerollTeams`, `swapPlayers`, `startSchedule` (per format), `setGameScore` (+ auto-advance), `advanceLeagueToPlayoffs`, `endGameday` (creator or owner → delete).
- Reuse `lib/stats.ts` `aggregateRatings`/`buildFeatureVectors`; extend `buildPlayerStats` to honor `display_options` + always-70–100 numbers (generalize the existing `overallTo100` to per-attribute display).

## Algorithm changes
- **`lib/balancing.ts`** — (a) **substitutes:** `numTeams = max(2, floor(N/size))`, fill exactly `size` per team, return leftovers as `substitutes`; (b) **variety:** keep a pool of solutions whose cost is within ε of the best and **randomly pick one** (seeded by `Math.random()`), so identical rosters reshuffle differently. Extend `scripts/test-balance.ts` to assert subs handling + that repeated runs differ while staying balanced.
- **`lib/bracket.ts`** — add **`league` format**: each team plays `league_games` varied opponents (partial round-robin), then top N (4→semis+final, 3→final) via `computeStandings` (reuse). Keep `auto`, `knockout`; `teams_only` schedules nothing.

## UI structure
- Routes: `/home` lists **groups**; `/tournament/[id]` → **`/group/[id]`**.
- **Group page** tabs: **Players** (roster, rate, who's-done for owner, group settings for owner) · **Gamedays** (list of active gamedays + "New gameday") · the **rate** UI (reuse `RatingTab`, threshold 40%).
- **New gameday flow** (`/group/[id]/gameday/new` or modal): multi-select players, team size, format (+ league games), create.
- **Gameday view** (`/group/[id]/gameday/[gid]`): teams + substitutes, re-roll/swap, schedule/bracket/standings, score entry, **▶ Intro** matchup card (reuse `MatchupCard`), **"End gameday"** (creator/owner). Reuse `TeamsTab`/`BracketTab`/`StatsTab` adapted to gameday scope; stats display driven by `display_options`.
- Update `components/RealtimeRefresh.tsx` to the new table names and add gameday-scoped channels.

---

## Migration & rollout safety
- **Back up first:** snapshot/duplicate the Supabase project (or test `0002_to_groups.sql` on a throwaway copy) before running it on live. The script is transactional, but a copy is the safety net.
- Run order on live: `0002_to_groups.sql` once → deploy the new app build. The live group appears with its roster + ratings intact, no gamedays yet, owner can immediately create one.
- Add a `deleteGroup` (owner) so the leftover **test** group can be removed.

## Verification
- `npm run build` + `npx tsc --noEmit` clean.
- `npm run test:balance` extended: substitutes, league scheduling, and **variety** (same roster → different splits, all within balance tolerance).
- Update `scripts/seed.ts` to seed a **group** with ratings + one sample gameday.
- Manual end-to-end on a **copy** of prod: confirm the migrated live group keeps every rating, create a gameday (each format), reroll varies teams, under-40% player is avg-filled, scores advance, end-gameday deletes only that gameday, and each `display_options` combination shows/hides the right things with numbers on 70–100. Confirm anonymity (no client can read raw ratings) and the owner-only who's-done window still hold.

---

## Deferred — Phase 2 (Soccer) & Phase 3 (Hebrew), not in this plan
- **Phase 2 — soccer:** `sport` already in the model. Add a soccer attribute set (params TBD with user), skip archetypes for soccer, reuse everything else. Ratings are already per-group, so a user can be in multiple groups with independent ratings.
- **Phase 3 — Hebrew/RTL:** language toggle in the header (persisted), translation dictionaries, `dir="rtl"` on `<html>`, and an RTL audit of directional Tailwind classes. Player-entered text stays as typed.
- Open items to confirm when those phases start: exact soccer rating parameters (and goalkeeper handling), and i18n approach (lightweight dictionary vs `next-intl`).
