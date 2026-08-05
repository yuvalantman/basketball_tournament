"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { aggregateRatings, buildFeatureVectors, type RatingRow } from "@/lib/stats";
import { balanceTeams, gamedayTeamSizes } from "@/lib/balancing";
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

// --- create / roster ---------------------------------------------------------

export async function createGameday(
  groupId: string,
  input: { name: string; date: string; teamSize: number; initialUserIds: string[] },
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
      })
      .select("id")
      .single();
    if (error || !gameday) throw new Error(error?.message);

    const userIds = new Set(input.initialUserIds);
    userIds.add(uid); // creator is always in their own gameday by default
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

export async function addToWaitlist(gamedayId: string, userId: string): Promise<ActionResult> {
  try {
    const { groupId } = await requireGamedayManager(gamedayId);
    const admin = createAdminClient();
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
  return upsertRating(groupId, rateeId, values);
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

async function runGeneration(gamedayId: string, seed: number): Promise<ActionResult> {
  const admin = createAdminClient();

  const { data: gameday } = await admin
    .from("gamedays")
    .select("group_id, team_size, groups(sport)")
    .eq("id", gamedayId)
    .single();
  if (!gameday) throw new Error("Gameday not found");
  const groupId = gameday.group_id as string;
  const sport = ((gameday.groups as unknown as { sport: SportId } | null)?.sport ?? "basketball") as SportId;
  const sportConfig = SPORTS[sport];

  const { data: participants } = await admin
    .from("gameday_participants")
    .select("kind, participant_id, added_at")
    .eq("gameday_id", gamedayId);
  const memberIds = (participants ?? []).filter((p) => p.kind === "member").map((p) => p.participant_id);
  const guestIds = (participants ?? []).filter((p) => p.kind === "guest").map((p) => p.participant_id);
  const addedAtById = new Map((participants ?? []).map((p) => [p.participant_id, p.added_at as string]));
  const kindById = new Map((participants ?? []).map((p) => [p.participant_id, p.kind as ParticipantKind]));

  if (memberIds.length + guestIds.length < 2) {
    return { ok: false, error: "Need at least 2 players in this gameday." };
  }

  const { data: memberProfiles } = memberIds.length
    ? await admin.from("profiles").select("id, height_cm, gender").in("id", memberIds)
    : { data: [] as { id: string; height_cm: number | null; gender: "M" | "F" | null }[] };
  const { data: guestProfiles } = guestIds.length
    ? await admin.from("gameday_guests").select("id, height_cm, gender").in("id", guestIds)
    : { data: [] as { id: string; height_cm: number | null; gender: "M" | "F" | null }[] };

  const players = [
    ...(memberProfiles ?? []).map((p) => ({ id: p.id, height_cm: p.height_cm, gender: p.gender })),
    ...(guestProfiles ?? []).map((p) => ({ id: p.id, height_cm: p.height_cm, gender: p.gender })),
  ];

  // Ratings: real group ratings for members, the single guest rating for
  // guests — fed into the SAME aggregation call since it only cares about
  // (rater_id, ratee_id, values, weight), not whether an id is a profile or
  // a guest. This is what keeps balancing fully polymorphic with no
  // member/guest branching in the math itself.
  const { data: memberRatings } = memberIds.length
    ? await admin.from("ratings").select("rater_id, ratee_id, values, weight").eq("group_id", groupId).in("ratee_id", memberIds)
    : { data: [] as RatingRow[] };
  const { data: guestRatings } = guestIds.length
    ? await admin.from("gameday_guest_ratings").select("guest_id, rated_by, values").in("guest_id", guestIds)
    : { data: [] as { guest_id: string; rated_by: string; values: Record<string, number> }[] };

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

  const { data: restrictionRows } = await admin
    .from("gameday_restrictions")
    .select("a_id, b_id")
    .eq("gameday_id", gamedayId)
    .eq("kind", "apart");
  const restrictions = (restrictionRows ?? []).map((r) => [r.a_id, r.b_id] as [string, string]);

  const { numTeams, sizes } = gamedayTeamSizes(players.length, gameday.team_size as number);
  const result = balanceTeams(vectors, gameday.team_size as number, restrictions, seed, sizes);

  // Persist: wipe old teams (cascade removes members) then insert fresh.
  await admin.from("teams").delete().eq("gameday_id", gamedayId);

  for (let i = 0; i < result.teams.length; i++) {
    const { data: team } = await admin
      .from("teams")
      .insert({ gameday_id: gamedayId, name: TEAM_NAMES[i] ?? `Team ${i + 1}`, seed: i + 1 })
      .select("id")
      .single();
    if (!team) continue;

    const roster = result.teams[i];
    const targetSize = gameday.team_size as number;
    const extra = Math.max(0, roster.length - targetSize);
    // Reserve labeling is cosmetic only (doesn't affect balance math, which
    // already ran above): the most-recently-added players in an over-quota
    // team are flagged as reserves.
    const sortedByRecency = roster
      .slice()
      .sort((a, b) => (addedAtById.get(b) ?? "").localeCompare(addedAtById.get(a) ?? ""));
    const reserveIds = new Set(sortedByRecency.slice(0, extra));

    const members = roster.map((participantId) => ({
      team_id: team.id,
      kind: kindById.get(participantId) ?? "member",
      participant_id: participantId,
      is_reserve: reserveIds.has(participantId),
    }));
    if (members.length) await admin.from("team_members").insert(members);
  }

  return {
    ok: true,
    data: { numTeams, restrictionViolations: result.restrictionViolations },
  };
}

export async function generateGamedayTeams(gamedayId: string): Promise<ActionResult> {
  try {
    await requireGamedayManager(gamedayId);
    const result = await runGeneration(gamedayId, Math.floor(Math.random() * 1e9));
    const groupId = await getGamedayGroupId(gamedayId);
    revalidatePath(`/group/${groupId}/gameday/${gamedayId}`);
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function rerollGamedayTeams(gamedayId: string): Promise<ActionResult> {
  return generateGamedayTeams(gamedayId);
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
