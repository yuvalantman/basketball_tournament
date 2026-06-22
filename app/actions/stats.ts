"use server";

import { getCurrentUserId } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aggregateRatings, buildPlayerStats, type RatingRow } from "@/lib/stats";
import type { RatingMode, StatsVisibility } from "@/lib/constants";
import type { PlayerStats, Profile } from "@/lib/types";

// Returns per-player aggregate stats, filtered by the tournament's
// stats_visibility setting and whether the caller is the creator. Raw,
// per-rater data NEVER leaves this server function.
export async function getPlayerStats(
  tournamentId: string,
): Promise<PlayerStats[] | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const admin = createAdminClient();

  // Caller must be a member.
  const { data: membership } = await admin
    .from("tournament_players")
    .select("user_id")
    .eq("tournament_id", tournamentId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!membership) return null;

  const { data: tournament } = await admin
    .from("tournaments")
    .select("rating_mode, stats_visibility, status, creator_id")
    .eq("id", tournamentId)
    .single();
  if (!tournament) return null;

  // Stats are only revealed once rating has closed.
  if (tournament.status === "lobby" || tournament.status === "rating")
    return [];

  const { data: tp } = await admin
    .from("tournament_players")
    .select("profiles(*)")
    .eq("tournament_id", tournamentId);
  const players: Profile[] = (tp ?? []).map(
    (r) => r.profiles as unknown as Profile,
  );

  const { data: ratings } = await admin
    .from("ratings")
    .select(
      "ratee_id, shooting, scoring, dribbling, rebounding, passing, defending, physicality, athleticism, single_score",
    )
    .eq("tournament_id", tournamentId);

  const aggregates = aggregateRatings(
    (ratings ?? []) as RatingRow[],
    tournament.rating_mode as RatingMode,
  );

  return buildPlayerStats(
    players,
    aggregates,
    tournament.rating_mode as RatingMode,
    tournament.stats_visibility as StatsVisibility,
    tournament.creator_id === uid,
  );
}
