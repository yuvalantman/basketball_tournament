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
