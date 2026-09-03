"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserId } from "@/lib/supabase/server";
import { aggregateRatings, buildPlayerCards, type RatingRow } from "@/lib/stats";
import { scoreToDisplay, type DisplayOptions } from "@/lib/constants";
import { SPORTS, type SportId } from "@/lib/sports";
import type { PlayerCard, Profile } from "@/lib/types";

// Player cards for a group's "Player cards" tab, gated by the group's
// display_options. Unlike v1, there is no closed "rating phase" — cards are
// visible whenever the group's settings say so, at any time.
export async function getPlayerCards(groupId: string): Promise<PlayerCard[] | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("group_players")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!membership) return null;

  const { data: group } = await admin
    .from("groups")
    .select("sport, display_options")
    .eq("id", groupId)
    .single();
  if (!group) return null;
  const sport = SPORTS[group.sport as SportId];

  const { data: gp } = await admin.from("group_players").select("profiles(*)").eq("group_id", groupId);
  const players: Profile[] = (gp ?? []).map((r) => r.profiles as unknown as Profile);

  const { data: ratings } = await admin
    .from("ratings")
    .select("rater_id, ratee_id, values, weight")
    .eq("group_id", groupId);

  const aggregates = aggregateRatings((ratings ?? []) as RatingRow[], sport);

  return buildPlayerCards(
    players,
    aggregates,
    sport,
    group.display_options as DisplayOptions,
    scoreToDisplay,
  );
}

export type MissingRatingsInfo = {
  userId: string;
  displayName: string;
  raterCount: number; // 0 = never rated by anyone
  missingParams: string[]; // sport params this player has zero raters for
};

// Drives the "some players have missing ratings" banner + per-card badge on
// the gameday creation/edit screen, for whichever member ids are passed in
// (the gameday's currently-selected player set).
export async function getMissingRatingsBanner(
  groupId: string,
  memberIds: string[],
): Promise<{ items: MissingRatingsInfo[] } | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const admin = createAdminClient();

  // Unlike a UI-driven call (which only ever passes the caller's own group's
  // roster), this is a directly-callable server action — verify membership
  // explicitly rather than trusting the groupId/memberIds a client sends,
  // matching the same check getPlayerCards already does above.
  const { data: membership } = await admin
    .from("group_players")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!membership) return null;

  if (memberIds.length === 0) return { items: [] };

  const { data: group } = await admin.from("groups").select("sport").eq("id", groupId).single();
  if (!group) return null;
  const sport = SPORTS[group.sport as SportId];

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", memberIds);

  const { data: ratings } = await admin
    .from("ratings")
    .select("ratee_id, values")
    .eq("group_id", groupId)
    .in("ratee_id", memberIds);

  const byRatee = new Map<string, { values: Record<string, number> }[]>();
  for (const r of ratings ?? []) {
    const arr = byRatee.get(r.ratee_id) ?? [];
    arr.push({ values: r.values as Record<string, number> });
    byRatee.set(r.ratee_id, arr);
  }

  const items: MissingRatingsInfo[] = [];
  for (const p of profiles ?? []) {
    const rows = byRatee.get(p.id) ?? [];
    const raterCount = rows.filter((r) => Object.keys(r.values ?? {}).length > 0).length;
    const missingParams = sport.params
      .filter((param) => !rows.some((r) => r.values?.[param.key] != null))
      .map((param) => param.key);
    if (raterCount === 0 || missingParams.length > 0) {
      items.push({ userId: p.id, displayName: p.display_name, raterCount, missingParams });
    }
  }
  return { items };
}

export type TeamStrength = {
  teamId: string;
  averageScore: number | null;
  playerCount: number;
  // Per-attribute team averages (70-100 scale) — the "Inspect" breakdown
  // behind the simple averageScore number, manager-only (unlike
  // averageScore, which can also be exposed to regular members via the
  // group's display_options.group_strength toggle).
  perParam: Record<string, number>;
};

// "Group strength": each of a gameday's generated teams' average score
// (70-100 scale), reusing the exact same aggregation
// app/actions/gameday.ts's runGeneration already does for balancing. This
// function computes the FULL result for any group member — the caller
// (GamedayView, via the page that fetches this) decides whether to actually
// render it, based on isManager or the group's display_options.group_strength
// toggle. Never exposes who rated what — only the aggregate.
export async function getGamedayTeamStrength(gamedayId: string): Promise<TeamStrength[] | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const admin = createAdminClient();

  const { data: gameday } = await admin
    .from("gamedays")
    .select("group_id, groups(sport)")
    .eq("id", gamedayId)
    .single();
  if (!gameday) return null;
  const groupId = gameday.group_id as string;
  const sport = SPORTS[((gameday.groups as unknown as { sport: SportId } | null)?.sport ?? "basketball") as SportId];

  const { data: membership } = await admin
    .from("group_players")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!membership) return null;

  const { data: teams } = await admin.from("teams").select("id").eq("gameday_id", gamedayId);
  const teamIds = (teams ?? []).map((t) => t.id);
  if (teamIds.length === 0) return [];

  const { data: memberRows } = await admin
    .from("team_members")
    .select("team_id, kind, participant_id")
    .in("team_id", teamIds);

  const memberIds = (memberRows ?? []).filter((m) => m.kind === "member").map((m) => m.participant_id);
  const guestIds = (memberRows ?? []).filter((m) => m.kind === "guest").map((m) => m.participant_id);

  const [{ data: memberRatings }, { data: guestRatings }] = await Promise.all([
    memberIds.length
      ? admin.from("ratings").select("rater_id, ratee_id, values, weight").eq("group_id", groupId).in("ratee_id", memberIds)
      : Promise.resolve({ data: [] as RatingRow[] }),
    guestIds.length
      ? admin.from("gameday_guest_ratings").select("guest_id, rated_by, values").in("guest_id", guestIds)
      : Promise.resolve({ data: [] as { guest_id: string; rated_by: string; values: Record<string, number> }[] }),
  ]);

  const combinedRows: RatingRow[] = [
    ...((memberRatings ?? []) as RatingRow[]),
    ...(guestRatings ?? []).map((g) => ({
      rater_id: g.rated_by,
      ratee_id: g.guest_id,
      values: g.values,
      weight: 1,
    })),
  ];
  const aggregates = aggregateRatings(combinedRows, sport);

  return teamIds.map((teamId) => {
    const ids = (memberRows ?? []).filter((m) => m.team_id === teamId).map((m) => m.participant_id);
    const scores = ids
      .map((id) => aggregates.get(id)?.score01)
      .filter((s): s is number => s != null);

    const perParam: Record<string, number> = {};
    for (const param of sport.params) {
      const own01s = ids
        .map((id) => aggregates.get(id)?.perParam[param.key])
        .filter((entry): entry is { weightedMean: number; raterCount: number } => entry != null)
        .map((entry) => (entry.weightedMean - param.scaleMin) / (param.scaleMax - param.scaleMin));
      if (own01s.length) perParam[param.key] = scoreToDisplay(own01s.reduce((a, b) => a + b, 0) / own01s.length);
    }

    return {
      teamId,
      averageScore: scores.length ? scoreToDisplay(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      playerCount: ids.length,
      perParam,
    };
  });
}
