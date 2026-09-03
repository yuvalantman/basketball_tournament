"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { aggregateRatings, buildFeatureVectors, type RatingRow } from "@/lib/stats";
import { balanceTeams, gamedayTeamSizes, type GamedaySplitMode } from "@/lib/balancing";
import { SPORTS, type SportId } from "@/lib/sports";
import type { ParticipantKind } from "@/lib/types";
import {
  type ActionResult,
  getGamedayGroupId,
  requireGamedayManager,
  requireGroupMember,
  requireUser,
} from "./_shared";
import { upsertRating } from "./rating";

type ParticipantRef = { kind: ParticipantKind; id: string };

async function requireGamedayCreator(gamedayId: string): Promise<{ uid: string; groupId: string }> {
  const uid = await requireUser();
  const admin = createAdminClient();
  const { data } = await admin.from("gamedays").select("creator_id, group_id").eq("id", gamedayId).single();
  if (!data) throw new Error("Gameday not found");
  if (data.creator_id !== uid) throw new Error("Only this gameday's creator can do that");
  return { uid, groupId: data.group_id };
}

// Defense in depth: confirms every id in `userIds` is actually a member of
// `groupId` before letting a gameday reference them as a participant/
// waitlist entry. Server actions are directly callable, not just from this
// app's own UI (which only ever offers the group's own roster) — without
// this, a caller could pass an arbitrary profile id.
async function requireGroupMembers(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const { data } = await admin
    .from("group_players")
    .select("user_id")
    .eq("group_id", groupId)
    .in("user_id", userIds);
  const found = new Set((data ?? []).map((r) => r.user_id));
  if (userIds.some((id) => !found.has(id))) {
    throw new Error("One of those players isn't a member of this group.");
  }
}

// --- create / roster ---------------------------------------------------------

export async function createGameday(
  groupId: string,
  input: {
    name: string;
    date: string;
    teamSize: number;
    initialUserIds: string[];
    maxPlayers?: number | null;
  },
): Promise<ActionResult> {
  try {
    const uid = await requireGroupMember(groupId);
    const admin = createAdminClient();

    const { data: gameday, error } = await admin
      .from("gamedays")
      .insert({
        group_id: groupId,
        creator_id: uid,
        name: input.name.trim() || "Gameday",
        date: input.date,
        team_size: input.teamSize,
        max_players: input.maxPlayers ?? null,
      })
      .select("id")
      .single();
    if (error || !gameday) throw new Error(error?.message);

    // NOT auto-adding the creator here on purpose — the creator can choose
    // not to play in their own gameday. NewGamedayForm defaults them into
    // the selection and confirms before submit if they've deselected
    // themselves, but whatever the client actually sends is respected.
    const userIds = new Set(input.initialUserIds);
    await requireGroupMembers(admin, groupId, Array.from(userIds));
    const participants = Array.from(userIds).map((userId) => ({
      gameday_id: gameday.id,
      kind: "member" as const,
      participant_id: userId,
    }));
    await admin.from("gameday_participants").insert(participants);

    revalidatePath(`/group/${groupId}`);
    return { ok: true, data: { id: gameday.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Creator-only (the gameday's OWN creator, not just the group manager) —
// guests are ephemeral, gameday-scoped, and rated ONLY by whoever added them.
export async function addGuest(
  gamedayId: string,
  guest: { name: string; gender: "M" | "F" | null; height_cm: number | null; photo_url: string | null },
  ratingValues: Record<string, number>,
): Promise<ActionResult> {
  try {
    const { uid, groupId } = await requireGamedayCreator(gamedayId);
    const admin = createAdminClient();

    const { data: group } = await admin.from("groups").select("sport").eq("id", groupId).single();
    const sport = (group?.sport as SportId) ?? "basketball";
    const allowedKeys = new Set(SPORTS[sport].params.map((p) => p.key));
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(ratingValues)) if (allowedKeys.has(k) && v != null) clean[k] = v;

    const { data: guestRow, error } = await admin
      .from("gameday_guests")
      .insert({
        gameday_id: gamedayId,
        name: guest.name.trim() || "Guest",
        gender: guest.gender,
        height_cm: guest.height_cm,
        photo_url: guest.photo_url,
        created_by: uid,
      })
      .select("id")
      .single();
    if (error || !guestRow) throw new Error(error?.message);

    await admin.from("gameday_guest_ratings").insert({
      guest_id: guestRow.id,
      rated_by: uid,
      values: clean,
    });
    await admin.from("gameday_participants").insert({
      gameday_id: gamedayId,
      kind: "guest",
      participant_id: guestRow.id,
    });

    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true, data: { id: guestRow.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function addParticipant(gamedayId: string, userId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await requireGroupMembers(admin, groupId, [userId]);
    await admin
      .from("gameday_participants")
      .upsert(
        { gameday_id: gamedayId, kind: "member", participant_id: userId },
        { onConflict: "gameday_id,kind,participant_id" },
      );
    await admin.from("gameday_waitlist").delete().eq("gameday_id", gamedayId).eq("user_id", userId);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Removes a member from the gameday entirely (not just their team). If a
// waitlist exists, the earliest-added waitlisted member is auto-promoted
// into the vacated slot — including the vacated TEAM slot, if the removed
// player had one — and the waitlist shifts up (the promoted row is simply
// deleted; ordering is by added_at, nothing else to renumber).
export async function removeParticipant(gamedayId: string, userId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();

    const { data: teams } = await admin.from("teams").select("id").eq("gameday_id", gamedayId);
    const teamIds = (teams ?? []).map((t) => t.id);
    let vacatedTeamId: string | null = null;
    let vacatedReserve = false;
    if (teamIds.length) {
      const { data: membership } = await admin
        .from("team_members")
        .select("team_id, is_reserve")
        .in("team_id", teamIds)
        .eq("kind", "member")
        .eq("participant_id", userId)
        .maybeSingle();
      if (membership) {
        vacatedTeamId = membership.team_id;
        vacatedReserve = membership.is_reserve;
        await admin
          .from("team_members")
          .delete()
          .eq("team_id", membership.team_id)
          .eq("kind", "member")
          .eq("participant_id", userId);
      }
    }

    await admin
      .from("gameday_participants")
      .delete()
      .eq("gameday_id", gamedayId)
      .eq("kind", "member")
      .eq("participant_id", userId);

    const { data: waitlistHead } = await admin
      .from("gameday_waitlist")
      .select("user_id")
      .eq("gameday_id", gamedayId)
      .order("added_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (waitlistHead) {
      await admin.from("gameday_waitlist").delete().eq("gameday_id", gamedayId).eq("user_id", waitlistHead.user_id);
      await admin
        .from("gameday_participants")
        .upsert(
          { gameday_id: gamedayId, kind: "member", participant_id: waitlistHead.user_id },
          { onConflict: "gameday_id,kind,participant_id" },
        );
      if (vacatedTeamId) {
        await admin.from("team_members").insert({
          team_id: vacatedTeamId,
          kind: "member",
          participant_id: waitlistHead.user_id,
          is_reserve: vacatedReserve,
        });
      }
    }

    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- waitlist -----------------------------------------------------------

export async function joinWaitlist(gamedayId: string): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const groupId = await getGamedayGroupId(gamedayId);
    await requireGroupMember(groupId);
    const admin = createAdminClient();
    await admin
      .from("gameday_waitlist")
      .upsert({ gameday_id: gamedayId, user_id: uid }, { onConflict: "gameday_id,user_id" });
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function leaveWaitlist(gamedayId: string): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const groupId = await getGamedayGroupId(gamedayId);
    const admin = createAdminClient();
    await admin.from("gameday_waitlist").delete().eq("gameday_id", gamedayId).eq("user_id", uid);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- self-service join (opt-in per gameday via max_players) -----------------

// Only enabled when the gameday's manager set a max_players cap at creation.
// Atomicity — never overbooking even when two people click Join at nearly
// the same instant — is handled entirely inside the join_gameday() Postgres
// function (see supabase/migrations/0007_gameday_self_join.sql), which locks
// the gameday's own row for the transaction. This action just authorizes
// the caller and relays the function's result; it does no capacity logic of
// its own on purpose (a second, separate "count then insert" here would
// reintroduce exactly the race the DB function exists to prevent).
export async function joinGameday(gamedayId: string): Promise<ActionResult> {
  try {
    const groupId = await getGamedayGroupId(gamedayId);
    const uid = await requireGroupMember(groupId);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("join_gameday", {
      p_gameday_id: gamedayId,
      p_user_id: uid,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Self-service leave for gamedays with self-join enabled — mirrors
// removeParticipant (vacate a team slot if any, promote the waitlist head
// into it), done atomically in leave_gameday() for the same reason
// join_gameday() is atomic.
export async function leaveGamedaySelf(gamedayId: string): Promise<ActionResult> {
  try {
    const groupId = await getGamedayGroupId(gamedayId);
    const uid = await requireGroupMember(groupId);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("leave_gameday", {
      p_gameday_id: gamedayId,
      p_user_id: uid,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function addToWaitlist(gamedayId: string, userId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await requireGroupMembers(admin, groupId, [userId]);
    await admin
      .from("gameday_waitlist")
      .upsert({ gameday_id: gamedayId, user_id: userId }, { onConflict: "gameday_id,user_id" });
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function removeFromWaitlist(gamedayId: string, userId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await admin.from("gameday_waitlist").delete().eq("gameday_id", gamedayId).eq("user_id", userId);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- quick-rate from within gameday creation/view ---------------------------

// Thin wrapper: always a NORMAL weight=1 rating, even if the caller happens
// to be the group's owner — the weight boost is tied exclusively to the
// dedicated manager-inspection entry point (rating.ts's submitManagerRating),
// never to this one, regardless of who's calling it.
export async function quickRateFromGameday(
  gamedayId: string,
  rateeId: string,
  values: Record<string, number>,
): Promise<ActionResult> {
  const groupId = await getGamedayGroupId(gamedayId);
  return upsertRating(groupId, rateeId, values, { ignoreGrantedWeight: true });
}

// --- restrictions (gameday-scoped) ------------------------------------------

export async function addRestriction(
  gamedayId: string,
  kind: "apart" | "together",
  a: ParticipantRef,
  b: ParticipantRef,
): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    if (a.kind === b.kind && a.id === b.id)
      return { ok: false, error: "Pick two different players." };
    const admin = createAdminClient();
    await admin.from("gameday_restrictions").insert({
      gameday_id: gamedayId,
      kind,
      a_kind: a.kind,
      a_id: a.id,
      b_kind: b.kind,
      b_id: b.id,
    });
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function removeRestriction(gamedayId: string, restrictionId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await admin.from("gameday_restrictions").delete().eq("id", restrictionId);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- team generation (multi-dimensional balancing, member + guest aware) ---

const TEAM_NAMES = [
  "Team Alpha", "Team Bravo", "Team Charlie", "Team Delta",
  "Team Echo", "Team Foxtrot", "Team Golf", "Team Hotel",
];

async function runGeneration(
  gamedayId: string,
  seed: number,
  splitMode: GamedaySplitMode = "reserves",
): Promise<ActionResult> {
  const admin = createAdminClient();

  // Wave 1: gameday/participants/restrictions only depend on gamedayId, not
  // on each other's results — fire together instead of 3 sequential trips.
  const [{ data: gameday }, { data: participants }, { data: restrictionRows }] = await Promise.all([
    admin.from("gamedays").select("group_id, team_size, groups(sport)").eq("id", gamedayId).single(),
    admin.from("gameday_participants").select("kind, participant_id, added_at").eq("gameday_id", gamedayId),
    admin.from("gameday_restrictions").select("a_id, b_id").eq("gameday_id", gamedayId).eq("kind", "apart"),
  ]);
  if (!gameday) throw new Error("Gameday not found");
  const groupId = gameday.group_id as string;
  const sport = ((gameday.groups as unknown as { sport: SportId } | null)?.sport ?? "basketball") as SportId;
  const sportConfig = SPORTS[sport];

  const memberIds = (participants ?? []).filter((p) => p.kind === "member").map((p) => p.participant_id);
  const guestIds = (participants ?? []).filter((p) => p.kind === "guest").map((p) => p.participant_id);
  const addedAtById = new Map((participants ?? []).map((p) => [p.participant_id, p.added_at as string]));
  const kindById = new Map((participants ?? []).map((p) => [p.participant_id, p.kind as ParticipantKind]));
  const restrictions = (restrictionRows ?? []).map((r) => [r.a_id, r.b_id] as [string, string]);

  if (memberIds.length + guestIds.length < 2) {
    return { ok: false, error: "Need at least 2 players in this gameday." };
  }

  // Wave 2: member/guest profiles and their ratings, all independent of one
  // another once memberIds/guestIds are known.
  const [{ data: memberProfiles }, { data: guestProfiles }, { data: memberRatings }, { data: guestRatings }] =
    await Promise.all([
      memberIds.length
        ? admin.from("profiles").select("id, height_cm, gender").in("id", memberIds)
        : Promise.resolve({ data: [] as { id: string; height_cm: number | null; gender: "M" | "F" | null }[] }),
      guestIds.length
        ? admin.from("gameday_guests").select("id, height_cm, gender").in("id", guestIds)
        : Promise.resolve({ data: [] as { id: string; height_cm: number | null; gender: "M" | "F" | null }[] }),
      // Ratings: real group ratings for members, the single guest rating for
      // guests — fed into the SAME aggregation call since it only cares about
      // (rater_id, ratee_id, values, weight), not whether an id is a profile
      // or a guest. This is what keeps balancing fully polymorphic with no
      // member/guest branching in the math itself.
      memberIds.length
        ? admin.from("ratings").select("rater_id, ratee_id, values, weight").eq("group_id", groupId).in("ratee_id", memberIds)
        : Promise.resolve({ data: [] as RatingRow[] }),
      guestIds.length
        ? admin.from("gameday_guest_ratings").select("guest_id, rated_by, values").in("guest_id", guestIds)
        : Promise.resolve({ data: [] as { guest_id: string; rated_by: string; values: Record<string, number> }[] }),
    ]);

  const players = [
    ...(memberProfiles ?? []).map((p) => ({ id: p.id, height_cm: p.height_cm, gender: p.gender })),
    ...(guestProfiles ?? []).map((p) => ({ id: p.id, height_cm: p.height_cm, gender: p.gender })),
  ];

  const combinedRows: RatingRow[] = [
    ...((memberRatings ?? []) as RatingRow[]),
    ...(guestRatings ?? []).map((g) => ({
      rater_id: g.rated_by,
      ratee_id: g.guest_id,
      values: g.values,
      weight: 1,
    })),
  ];

  const aggregates = aggregateRatings(combinedRows, sportConfig);
  const vectors = buildFeatureVectors(players, aggregates, sportConfig);

  const { numTeams, sizes } = gamedayTeamSizes(players.length, gameday.team_size as number, splitMode);
  const result = balanceTeams(vectors, gameday.team_size as number, restrictions, seed, sizes);

  // Persist: wipe old teams (cascade removes members), then bulk-insert all
  // teams in one round trip, then all team_members in one more — regardless
  // of team count, instead of 2 round trips PER team.
  await admin.from("teams").delete().eq("gameday_id", gamedayId);

  const teamRows = result.teams.map((_, i) => ({
    gameday_id: gamedayId,
    name: TEAM_NAMES[i] ?? `Team ${i + 1}`,
    seed: i + 1,
  }));
  const { data: insertedTeams } = await admin.from("teams").insert(teamRows).select("id, seed");
  // Match by `seed` rather than trusting the returned rows to be in insert
  // order (Postgres/PostgREST don't guarantee that for a multi-row INSERT).
  const teamIdBySeed = new Map((insertedTeams ?? []).map((t) => [t.seed, t.id]));
  const targetSize = gameday.team_size as number;

  const allMembers = result.teams.flatMap((roster, i) => {
    const teamId = teamIdBySeed.get(i + 1);
    if (!teamId) return [];
    const extra = Math.max(0, roster.length - targetSize);
    // Reserve labeling is cosmetic only (doesn't affect balance math, which
    // already ran above): the most-recently-added players in an over-quota
    // team are flagged as reserves.
    const sortedByRecency = roster
      .slice()
      .sort((a, b) => (addedAtById.get(b) ?? "").localeCompare(addedAtById.get(a) ?? ""));
    const reserveIds = new Set(sortedByRecency.slice(0, extra));

    return roster.map((participantId) => ({
      team_id: teamId,
      kind: kindById.get(participantId) ?? "member",
      participant_id: participantId,
      is_reserve: reserveIds.has(participantId),
    }));
  });
  if (allMembers.length) await admin.from("team_members").insert(allMembers);

  return {
    ok: true,
    data: { numTeams, restrictionViolations: result.restrictionViolations },
  };
}

export async function generateGamedayTeams(
  gamedayId: string,
  splitMode: GamedaySplitMode = "reserves",
): Promise<ActionResult> {
  try {
    await requireGamedayManager(gamedayId);
    const result = await runGeneration(gamedayId, Math.floor(Math.random() * 1e9), splitMode);
    const groupId = await getGamedayGroupId(gamedayId);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function rerollGamedayTeams(
  gamedayId: string,
  splitMode: GamedaySplitMode = "reserves",
): Promise<ActionResult> {
  return generateGamedayTeams(gamedayId, splitMode);
}

// Undo team generation entirely — back to just a participant list, with no
// teams. Repeatable any number of times, same as regenerating: this only
// deletes `teams` (team_members cascades), it never touches participants,
// the waitlist, or restrictions.
export async function removeGamedayTeams(gamedayId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await admin.from("teams").delete().eq("gameday_id", gamedayId);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --- manual team edits -------------------------------------------------------

export async function swapGamedayPlayers(
  gamedayId: string,
  a: ParticipantRef,
  teamAId: string,
  b: ParticipantRef,
  teamBId: string,
): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await admin.from("team_members").delete().eq("team_id", teamAId).eq("kind", a.kind).eq("participant_id", a.id);
    await admin.from("team_members").delete().eq("team_id", teamBId).eq("kind", b.kind).eq("participant_id", b.id);
    await admin.from("team_members").insert([
      { team_id: teamBId, kind: a.kind, participant_id: a.id, is_reserve: false },
      { team_id: teamAId, kind: b.kind, participant_id: b.id, is_reserve: false },
    ]);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function assignGamedayParticipant(
  gamedayId: string,
  participant: ParticipantRef,
  teamId: string,
): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();

    const { data: teams } = await admin.from("teams").select("id").eq("gameday_id", gamedayId);
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length)
      await admin
        .from("team_members")
        .delete()
        .in("team_id", teamIds)
        .eq("kind", participant.kind)
        .eq("participant_id", participant.id);

    await admin
      .from("team_members")
      .insert({ team_id: teamId, kind: participant.kind, participant_id: participant.id, is_reserve: false });

    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function removeFromGamedayTeam(gamedayId: string, participant: ParticipantRef): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    const { data: teams } = await admin.from("teams").select("id").eq("gameday_id", gamedayId);
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length)
      await admin
        .from("team_members")
        .delete()
        .in("team_id", teamIds)
        .eq("kind", participant.kind)
        .eq("participant_id", participant.id);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function renameTeam(gamedayId: string, teamId: string, name: string): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const clean = name.trim().slice(0, 30);
    if (!clean) return { ok: false, error: "Team name can't be empty." };

    const admin = createAdminClient();
    const { data: team } = await admin.from("teams").select("id, gameday_id").eq("id", teamId).single();
    if (!team || team.gameday_id !== gamedayId) return { ok: false, error: "Team not found." };

    const { data: membership } = await admin
      .from("team_members")
      .select("participant_id")
      .eq("team_id", teamId)
      .eq("kind", "member")
      .eq("participant_id", uid)
      .maybeSingle();

    const { data: gameday } = await admin.from("gamedays").select("creator_id, group_id, groups(creator_id)").eq("id", gamedayId).single();
    const groupOwnerId = (gameday?.groups as unknown as { creator_id: string } | null)?.creator_id;
    const isManager = gameday?.creator_id === uid || groupOwnerId === uid;

    if (!membership && !isManager) return { ok: false, error: "Only this team's players can rename it." };

    await admin.from("teams").update({ name: clean }).eq("id", teamId);
    revalidatePath(`/group/${gameday?.group_id}/gameday/${gamedayId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteGameday(gamedayId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
    await admin.from("gamedays").delete().eq("id", gamedayId);
    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
