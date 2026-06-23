"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateRatings,
  buildFeatureVectors,
  type RatingRow,
} from "@/lib/stats";
import { balanceTeams } from "@/lib/balancing";
import {
  computeStandings,
  planInitialSchedule,
  randomKnockout4,
  type GameSpec,
} from "@/lib/bracket";
import { requiredRatings } from "@/lib/constants";
import type {
  RatingMode,
  StatsVisibility,
  TeamSize,
  TournamentStatus,
} from "@/lib/constants";
import type { Profile } from "@/lib/types";

type ActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

function randomCode(len = 5): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// --- helpers ---------------------------------------------------------------

async function requireUser(): Promise<string> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("Not logged in");
  return uid;
}

async function requireCreator(tournamentId: string): Promise<string> {
  const uid = await requireUser();
  const admin = createAdminClient();
  const { data } = await admin
    .from("tournaments")
    .select("creator_id")
    .eq("id", tournamentId)
    .single();
  if (!data || data.creator_id !== uid)
    throw new Error("Only the tournament creator can do that");
  return uid;
}

// --- create / join ---------------------------------------------------------

export async function createTournament(input: {
  name: string;
  rating_mode: RatingMode;
  stats_visibility: StatsVisibility;
  team_size: TeamSize;
}): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const supabase = await createClient();

    // Generate a unique join code (retry on the rare collision).
    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase
        .from("tournaments")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = randomCode();
    }

    const { data: tournament, error } = await supabase
      .from("tournaments")
      .insert({
        code,
        name: input.name.trim() || "Tournament",
        creator_id: uid,
        rating_mode: input.rating_mode,
        stats_visibility: input.stats_visibility,
        team_size: input.team_size,
        status: "lobby",
      })
      .select("id")
      .single();
    if (error || !tournament) throw new Error(error?.message);

    // Creator auto-joins as a player.
    await supabase
      .from("tournament_players")
      .insert({ tournament_id: tournament.id, user_id: uid });

    revalidatePath("/home");
    return { ok: true, data: { id: tournament.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function joinTournament(codeInput: string): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const admin = createAdminClient();
    const code = codeInput.trim().toUpperCase();

    const { data: tournament } = await admin
      .from("tournaments")
      .select("id, status")
      .eq("code", code)
      .maybeSingle();
    if (!tournament) return { ok: false, error: "No tournament with that code." };
    // Late joins are allowed while still in the lobby or the rating phase. A
    // late joiner then needs to rate everyone and be rated by everyone — which
    // the progress panel reflects automatically (expected count is dynamic).
    if (tournament.status !== "lobby" && tournament.status !== "rating")
      return {
        ok: false,
        error: "This tournament has already moved past rating.",
      };

    await admin
      .from("tournament_players")
      .upsert(
        { tournament_id: tournament.id, user_id: uid },
        { onConflict: "tournament_id,user_id" },
      );

    revalidatePath("/home");
    return { ok: true, data: { id: tournament.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Creator removes a player (mistaken signup, dropout). Cleans up everything
// tied to that player in this tournament so stats/teams stay consistent.
export async function removePlayer(
  tournamentId: string,
  userId: string,
): Promise<ActionResult> {
  try {
    const creatorId = await requireCreator(tournamentId);
    if (userId === creatorId)
      return { ok: false, error: "The creator can't be removed." };
    const admin = createAdminClient();

    // Ratings this player gave or received.
    await admin
      .from("ratings")
      .delete()
      .eq("tournament_id", tournamentId)
      .or(`rater_id.eq.${userId},ratee_id.eq.${userId}`);

    // Restrictions referencing them.
    await admin
      .from("restrictions")
      .delete()
      .eq("tournament_id", tournamentId)
      .or(`player_a.eq.${userId},player_b.eq.${userId}`);

    // Team membership (within this tournament's teams).
    const { data: teams } = await admin
      .from("teams")
      .select("id")
      .eq("tournament_id", tournamentId);
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length)
      await admin
        .from("team_members")
        .delete()
        .in("team_id", teamIds)
        .eq("user_id", userId);

    // Finally, the roster row.
    await admin
      .from("tournament_players")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("user_id", userId);

    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- settings / phases ------------------------------------------------------

export async function updateSettings(
  tournamentId: string,
  patch: { team_size?: TeamSize; stats_visibility?: StatsVisibility; name?: string },
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const supabase = await createClient();
    const { error } = await supabase
      .from("tournaments")
      .update(patch)
      .eq("id", tournamentId);
    if (error) throw new Error(error.message);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setStatus(
  tournamentId: string,
  status: TournamentStatus,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const supabase = await createClient();
    const { error } = await supabase
      .from("tournaments")
      .update({ status })
      .eq("id", tournamentId);
    if (error) throw new Error(error.message);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- restrictions -----------------------------------------------------------

export async function addRestriction(
  tournamentId: string,
  playerA: string,
  playerB: string,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    if (playerA === playerB)
      return { ok: false, error: "Pick two different players." };
    const supabase = await createClient();
    const [a, b] = [playerA, playerB].sort();
    const { error } = await supabase
      .from("restrictions")
      .upsert(
        { tournament_id: tournamentId, player_a: a, player_b: b },
        { onConflict: "tournament_id,player_a,player_b" },
      );
    if (error) throw new Error(error.message);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function removeRestriction(
  tournamentId: string,
  restrictionId: string,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const supabase = await createClient();
    const { error } = await supabase
      .from("restrictions")
      .delete()
      .eq("id", restrictionId);
    if (error) throw new Error(error.message);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- rating progress (CREATOR ONLY, completion booleans only) --------------

export async function getRatingProgress(
  tournamentId: string,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const admin = createAdminClient();

    const { data: players } = await admin
      .from("tournament_players")
      .select("user_id, profiles(display_name, username)")
      .eq("tournament_id", tournamentId);
    const ids = (players ?? []).map((p) => p.user_id);
    // Each player must rate, and be rated by, at least this many others.
    const expected = requiredRatings(ids.length);

    // Count DISTINCT ratees each rater has rated. We deliberately only read
    // rater_id + ratee_id here — never the scores — so nothing about *how*
    // anyone rated is exposed.
    const { data: ratings } = await admin
      .from("ratings")
      .select("rater_id, ratee_id")
      .eq("tournament_id", tournamentId);

    // Two views: how many each player has rated (gave), and how many distinct
    // people have rated each player (received). Both expected to reach
    // `expected`. Scores themselves are never read.
    const gave = new Map<string, Set<string>>();
    const received = new Map<string, Set<string>>();
    for (const r of ratings ?? []) {
      (gave.get(r.rater_id) ?? gave.set(r.rater_id, new Set()).get(r.rater_id)!).add(
        r.ratee_id,
      );
      (
        received.get(r.ratee_id) ??
        received.set(r.ratee_id, new Set()).get(r.ratee_id)!
      ).add(r.rater_id);
    }

    const progress = (players ?? []).map((p) => {
      const ratedCount = gave.get(p.user_id)?.size ?? 0;
      const ratedByCount = received.get(p.user_id)?.size ?? 0;
      const profile = p.profiles as unknown as {
        display_name: string;
        username: string;
      } | null;
      return {
        user_id: p.user_id,
        display_name: profile?.display_name ?? profile?.username ?? "Player",
        rated: ratedCount,
        ratedBy: ratedByCount,
        expected,
        completed: expected > 0 && ratedCount >= expected,
        fullyRated: expected > 0 && ratedByCount >= expected,
      };
    });

    const allDone =
      progress.length > 1 &&
      progress.every((p) => p.completed && p.fullyRated);

    return { ok: true, data: { progress, allDone } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- team generation (multi-dimensional balancing) -------------------------

export async function generateTeams(
  tournamentId: string,
  seed?: number,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const admin = createAdminClient();

    const { data: tournament } = await admin
      .from("tournaments")
      .select("rating_mode, team_size")
      .eq("id", tournamentId)
      .single();
    if (!tournament) throw new Error("Tournament not found");
    const mode = tournament.rating_mode as RatingMode;

    // Load players + their profiles (heights), ratings, and restrictions.
    const { data: tp } = await admin
      .from("tournament_players")
      .select("user_id, profiles(*)")
      .eq("tournament_id", tournamentId);
    const players: Profile[] = (tp ?? []).map(
      (r) => r.profiles as unknown as Profile,
    );
    if (players.length < 2) throw new Error("Need at least 2 players.");

    const { data: ratings } = await admin
      .from("ratings")
      .select(
        "rater_id, ratee_id, shooting, scoring, dribbling, rebounding, passing, defending, physicality, athleticism, single_score",
      )
      .eq("tournament_id", tournamentId);

    // Enforce the coverage rule: every player must have rated, and been rated
    // by, at least the required number of others before teams can be built.
    const required = requiredRatings(players.length);
    if (required > 0) {
      const gave = new Map<string, Set<string>>();
      const received = new Map<string, Set<string>>();
      for (const r of ratings ?? []) {
        (gave.get(r.rater_id) ?? gave.set(r.rater_id, new Set()).get(r.rater_id)!).add(
          r.ratee_id,
        );
        (
          received.get(r.ratee_id) ??
          received.set(r.ratee_id, new Set()).get(r.ratee_id)!
        ).add(r.rater_id);
      }
      const short = players.filter(
        (p) =>
          (gave.get(p.id)?.size ?? 0) < required ||
          (received.get(p.id)?.size ?? 0) < required,
      );
      if (short.length > 0) {
        const names = short
          .slice(0, 5)
          .map((p) => p.display_name)
          .join(", ");
        return {
          ok: false,
          error: `Everyone must rate and be rated by at least ${required} players first. Still short: ${names}${short.length > 5 ? "…" : ""}.`,
        };
      }
    }

    const { data: restrictionRows } = await admin
      .from("restrictions")
      .select("player_a, player_b")
      .eq("tournament_id", tournamentId);

    const aggregates = aggregateRatings(
      (ratings ?? []) as RatingRow[],
      mode,
    );
    const vectors = buildFeatureVectors(players, aggregates, mode);
    const restrictions = (restrictionRows ?? []).map(
      (r) => [r.player_a, r.player_b] as [string, string],
    );

    const result = balanceTeams(
      vectors,
      tournament.team_size,
      restrictions,
      seed ?? Math.floor(Math.random() * 1e9),
    );

    // Persist: wipe old teams (cascade removes members) then insert fresh.
    await admin.from("teams").delete().eq("tournament_id", tournamentId);

    const teamNames = [
      "Team Alpha",
      "Team Bravo",
      "Team Charlie",
      "Team Delta",
      "Team Echo",
      "Team Foxtrot",
      "Team Golf",
      "Team Hotel",
    ];
    for (let i = 0; i < result.teams.length; i++) {
      const { data: team } = await admin
        .from("teams")
        .insert({
          tournament_id: tournamentId,
          name: teamNames[i] ?? `Team ${i + 1}`,
          seed: i + 1,
        })
        .select("id")
        .single();
      if (!team) continue;
      const members = result.teams[i].map((userId) => ({
        team_id: team.id,
        user_id: userId,
      }));
      if (members.length) await admin.from("team_members").insert(members);
    }

    await admin
      .from("tournaments")
      .update({ status: "teams" })
      .eq("id", tournamentId);

    revalidatePath(`/tournament/${tournamentId}`);
    return {
      ok: true,
      data: {
        restrictionViolations: result.restrictionViolations,
        numTeams: result.teams.length,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Manual swap of two players between teams (creator tweak).
export async function swapPlayers(
  tournamentId: string,
  userA: string,
  teamAId: string,
  userB: string,
  teamBId: string,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const admin = createAdminClient();
    // Move A -> teamB, B -> teamA.
    await admin
      .from("team_members")
      .delete()
      .eq("team_id", teamAId)
      .eq("user_id", userA);
    await admin
      .from("team_members")
      .delete()
      .eq("team_id", teamBId)
      .eq("user_id", userB);
    await admin
      .from("team_members")
      .insert([
        { team_id: teamBId, user_id: userA },
        { team_id: teamAId, user_id: userB },
      ]);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Any member of a team can rename their own team; the new name shows for
// everyone (realtime-propagated). The tournament creator can rename any team.
export async function renameTeam(
  tournamentId: string,
  teamId: string,
  name: string,
): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const clean = name.trim().slice(0, 30);
    if (!clean) return { ok: false, error: "Team name can't be empty." };

    const admin = createAdminClient();
    const { data: team } = await admin
      .from("teams")
      .select("id, tournament_id")
      .eq("id", teamId)
      .single();
    if (!team || team.tournament_id !== tournamentId)
      return { ok: false, error: "Team not found." };

    // Authorized if you're on that team, or you're the tournament creator.
    const { data: membership } = await admin
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", uid)
      .maybeSingle();
    const { data: tournament } = await admin
      .from("tournaments")
      .select("creator_id")
      .eq("id", tournamentId)
      .single();
    if (!membership && tournament?.creator_id !== uid)
      return { ok: false, error: "Only this team's players can rename it." };

    await admin.from("teams").update({ name: clean }).eq("id", teamId);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- schedule / bracket -----------------------------------------------------

// Insert a set of GameSpecs and wire up winner/loser advancement links.
async function persistGames(
  admin: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  specs: GameSpec[],
) {
  // Insert all games first (without links), keyed by round+slot.
  const idByKey = new Map<string, string>();
  for (const g of specs) {
    const { data } = await admin
      .from("games")
      .insert({
        tournament_id: tournamentId,
        stage: g.stage,
        round: g.round,
        slot: g.slot,
        team_a: g.teamA,
        team_b: g.teamB,
      })
      .select("id")
      .single();
    if (data) idByKey.set(`${g.round}:${g.slot}`, data.id);
  }
  // Second pass: set next_game_id / loser_game_id from feeds.
  for (const g of specs) {
    const id = idByKey.get(`${g.round}:${g.slot}`);
    if (!id) continue;
    const patch: Record<string, unknown> = {};
    if (g.winnerFeeds) {
      patch.next_game_id = idByKey.get(
        `${g.winnerFeeds.round}:${g.winnerFeeds.slot}`,
      );
      patch.next_slot = g.winnerFeeds.position;
    }
    if (g.loserFeeds) {
      patch.loser_game_id = idByKey.get(
        `${g.loserFeeds.round}:${g.loserFeeds.slot}`,
      );
      patch.loser_slot = g.loserFeeds.position;
    }
    if (Object.keys(patch).length) await admin.from("games").update(patch).eq("id", id);
  }
}

// Move from team reveal to playing: build the initial schedule. With >4 teams
// this creates the group stage; with exactly 4 a seeded bracket; etc.
export async function startSchedule(tournamentId: string): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const admin = createAdminClient();

    const { data: teams } = await admin
      .from("teams")
      .select("id, seed")
      .eq("tournament_id", tournamentId)
      .order("seed");
    if (!teams || teams.length < 2)
      return { ok: false, error: "Generate teams first." };

    // teams are seeded by balancing order; treat that as strength order.
    const ordered = teams.map((t) => t.id);
    await admin.from("games").delete().eq("tournament_id", tournamentId);

    const plan = planInitialSchedule(ordered, Math.floor(Math.random() * 1e9));
    await persistGames(admin, tournamentId, plan.games);

    await admin
      .from("tournaments")
      .update({ status: "bracket" })
      .eq("id", tournamentId);
    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true, data: { kind: plan.kind } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// After group games are scored, lock the top 4 into a random bracket.
export async function advanceGroupToBracket(
  tournamentId: string,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    const admin = createAdminClient();

    const { data: teams } = await admin
      .from("teams")
      .select("id")
      .eq("tournament_id", tournamentId);
    const { data: groupGames } = await admin
      .from("games")
      .select("team_a, team_b, score_a, score_b")
      .eq("tournament_id", tournamentId)
      .eq("stage", "group");

    const unfinished = (groupGames ?? []).some(
      (g) => g.score_a == null || g.score_b == null,
    );
    if (unfinished)
      return { ok: false, error: "Enter all group scores first." };

    const standings = computeStandings(
      (teams ?? []).map((t) => t.id),
      groupGames ?? [],
    );
    const top4 = standings.slice(0, 4).map((s) => s.teamId);
    if (top4.length < 4)
      return { ok: false, error: "Need at least 4 teams to make a bracket." };

    const specs = randomKnockout4(top4, Math.floor(Math.random() * 1e9));
    await persistGames(admin, tournamentId, specs);

    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- scoring + auto-advance -------------------------------------------------

export async function setGameScore(
  tournamentId: string,
  gameId: string,
  scoreA: number,
  scoreB: number,
): Promise<ActionResult> {
  try {
    await requireCreator(tournamentId);
    if (scoreA === scoreB)
      return { ok: false, error: "Games can't end in a tie." };
    const admin = createAdminClient();

    const { data: game } = await admin
      .from("games")
      .select(
        "id, team_a, team_b, stage, next_game_id, next_slot, loser_game_id, loser_slot",
      )
      .eq("id", gameId)
      .single();
    if (!game) throw new Error("Game not found");
    if (!game.team_a || !game.team_b)
      return { ok: false, error: "Both teams must be set before scoring." };

    const winner = scoreA > scoreB ? game.team_a : game.team_b;
    const loser = scoreA > scoreB ? game.team_b : game.team_a;

    await admin
      .from("games")
      .update({ score_a: scoreA, score_b: scoreB, winner_team_id: winner })
      .eq("id", gameId);

    // Bracket advancement: push winner/loser into their next slots.
    if (game.next_game_id && game.next_slot) {
      await admin
        .from("games")
        .update({ [`team_${game.next_slot}`]: winner })
        .eq("id", game.next_game_id);
    }
    if (game.loser_game_id && game.loser_slot) {
      await admin
        .from("games")
        .update({ [`team_${game.loser_slot}`]: loser })
        .eq("id", game.loser_game_id);
    }

    revalidatePath(`/tournament/${tournamentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
