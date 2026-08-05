import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  Gameday,
  GamedayGuest,
  GamedayRestriction,
  Group,
  Participant,
  ParticipantKind,
  Profile,
  Team,
  WaitlistEntry,
} from "@/lib/types";

// RLS-bound reads used by Server Components. These only return rows the
// logged-in user is allowed to see (group members, own profile, etc.).

export async function getMyProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data as Profile | null;
}

export async function getGroup(id: string): Promise<Group | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("groups").select("*").eq("id", id).maybeSingle();
  return data as Group | null;
}

export async function getRoster(groupId: string): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("group_players").select("profiles(*)").eq("group_id", groupId);
  return (data ?? [])
    .map((r) => r.profiles as unknown as Profile)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// Resolve a list of (kind, participant_id) refs into full Participant
// objects (profile for members, gameday_guests row for guests) with a
// single query per kind rather than one query per row.
async function resolveParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  refs: { kind: ParticipantKind; participant_id: string }[],
): Promise<Map<string, Participant>> {
  const memberIds = refs.filter((r) => r.kind === "member").map((r) => r.participant_id);
  const guestIds = refs.filter((r) => r.kind === "guest").map((r) => r.participant_id);

  const out = new Map<string, Participant>();
  if (memberIds.length) {
    const { data } = await supabase.from("profiles").select("*").in("id", memberIds);
    for (const p of (data ?? []) as Profile[]) out.set(`member:${p.id}`, { kind: "member", id: p.id, profile: p });
  }
  if (guestIds.length) {
    const { data } = await supabase.from("gameday_guests").select("*").in("id", guestIds);
    for (const g of (data ?? []) as GamedayGuest[]) out.set(`guest:${g.id}`, { kind: "guest", id: g.id, guest: g });
  }
  return out;
}

export type GamedayWithStatus = Gameday & {
  participantCount: number;
  creatorName: string;
  myStatus:
    | { kind: "playing"; teamName: string }
    | { kind: "waitlisted"; position: number }
    | { kind: "unassigned" } // in the gameday but teams not generated / not on a team yet
    | { kind: "none" };
};

export async function getGamedaysForGroup(groupId: string): Promise<GamedayWithStatus[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id;

  const { data: gamedays } = await supabase
    .from("gamedays")
    .select("*")
    .eq("group_id", groupId)
    .order("date", { ascending: true });
  if (!gamedays || gamedays.length === 0) return [];

  const { data: creators } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", gamedays.map((g) => g.creator_id));
  const creatorName = new Map((creators ?? []).map((c) => [c.id, c.display_name]));

  const gamedayIds = gamedays.map((g) => g.id);
  const { data: participants } = await supabase
    .from("gameday_participants")
    .select("gameday_id, kind, participant_id")
    .in("gameday_id", gamedayIds);
  const { data: waitlist } = await supabase
    .from("gameday_waitlist")
    .select("gameday_id, user_id, added_at")
    .in("gameday_id", gamedayIds)
    .order("added_at", { ascending: true });
  const { data: teamMembers } = await supabase
    .from("team_members")
    .select("team_id, kind, participant_id, teams(id, gameday_id, name)")
    .in(
      "team_id",
      (
        await supabase.from("teams").select("id").in("gameday_id", gamedayIds)
      ).data?.map((t) => t.id) ?? [],
    );

  const countByGameday = new Map<string, number>();
  for (const p of participants ?? []) {
    countByGameday.set(p.gameday_id, (countByGameday.get(p.gameday_id) ?? 0) + 1);
  }

  return gamedays.map((g) => {
    const count = countByGameday.get(g.id) ?? 0;
    let myStatus: GamedayWithStatus["myStatus"] = { kind: "none" };

    if (uid) {
      const myTeamRow = (teamMembers ?? []).find((tm) => {
        const team = tm.teams as unknown as { gameday_id: string; name: string } | null;
        return team?.gameday_id === g.id && tm.kind === "member" && tm.participant_id === uid;
      });
      if (myTeamRow) {
        const team = myTeamRow.teams as unknown as { name: string };
        myStatus = { kind: "playing", teamName: team.name };
      } else {
        const isParticipant = (participants ?? []).some(
          (p) => p.gameday_id === g.id && p.kind === "member" && p.participant_id === uid,
        );
        if (isParticipant) {
          myStatus = { kind: "unassigned" };
        } else {
          const wl = (waitlist ?? []).filter((w) => w.gameday_id === g.id);
          const idx = wl.findIndex((w) => w.user_id === uid);
          if (idx >= 0) myStatus = { kind: "waitlisted", position: idx + 1 };
        }
      }
    }

    return {
      ...(g as Gameday),
      participantCount: count,
      creatorName: creatorName.get(g.creator_id) ?? "Someone",
      myStatus,
    };
  });
}

export type GamedayDetail = {
  gameday: Gameday;
  participants: Participant[];
  waitlist: WaitlistEntry[];
  teams: Team[];
  restrictions: GamedayRestriction[];
};

export async function getGamedayDetail(gamedayId: string): Promise<GamedayDetail | null> {
  const supabase = await createClient();

  const { data: gameday } = await supabase.from("gamedays").select("*").eq("id", gamedayId).maybeSingle();
  if (!gameday) return null;

  const { data: participantRows } = await supabase
    .from("gameday_participants")
    .select("kind, participant_id, added_at")
    .eq("gameday_id", gamedayId)
    .order("added_at", { ascending: true });

  const resolved = await resolveParticipants(supabase, participantRows ?? []);
  const participants = (participantRows ?? [])
    .map((r) => resolved.get(`${r.kind}:${r.participant_id}`))
    .filter((p): p is Participant => p != null);

  const { data: waitlistRows } = await supabase
    .from("gameday_waitlist")
    .select("gameday_id, user_id, added_at, profiles(*)")
    .eq("gameday_id", gamedayId)
    .order("added_at", { ascending: true });
  const waitlist: WaitlistEntry[] = (waitlistRows ?? []).map((w, i) => ({
    gameday_id: w.gameday_id,
    user_id: w.user_id,
    added_at: w.added_at,
    profile: w.profiles as unknown as Profile,
    position: i + 1,
  }));

  const { data: teamRows } = await supabase.from("teams").select("*").eq("gameday_id", gamedayId).order("seed");
  const teamIds = (teamRows ?? []).map((t) => t.id);
  const { data: memberRows } = teamIds.length
    ? await supabase.from("team_members").select("team_id, kind, participant_id, is_reserve").in("team_id", teamIds)
    : { data: [] as { team_id: string; kind: ParticipantKind; participant_id: string; is_reserve: boolean }[] };
  const memberResolved = await resolveParticipants(supabase, memberRows ?? []);
  const teams: Team[] = (teamRows ?? []).map((t) => ({
    ...(t as Team),
    members: (memberRows ?? [])
      .filter((m) => m.team_id === t.id)
      .map((m) => {
        const p = memberResolved.get(`${m.kind}:${m.participant_id}`);
        return p ? { ...p, is_reserve: m.is_reserve } : null;
      })
      .filter((p): p is Participant & { is_reserve: boolean } => p != null),
  }));

  const { data: restrictionRows } = await supabase
    .from("gameday_restrictions")
    .select("*")
    .eq("gameday_id", gamedayId);
  const restrictionRefs = (restrictionRows ?? []).flatMap((r) => [
    { kind: r.a_kind as ParticipantKind, participant_id: r.a_id },
    { kind: r.b_kind as ParticipantKind, participant_id: r.b_id },
  ]);
  const restrictionResolved = await resolveParticipants(supabase, restrictionRefs);
  const restrictions: GamedayRestriction[] = (restrictionRows ?? [])
    .map((r) => {
      const a = restrictionResolved.get(`${r.a_kind}:${r.a_id}`);
      const b = restrictionResolved.get(`${r.b_kind}:${r.b_id}`);
      if (!a || !b) return null;
      return { id: r.id, gameday_id: r.gameday_id, kind: r.kind, a, b };
    })
    .filter((r): r is GamedayRestriction => r != null);

  return { gameday: gameday as Gameday, participants, waitlist, teams, restrictions };
}

// Which players the current user has already rated in this group (drives
// the Rate tab's "done" checkmarks).
export async function getMyRatedSet(groupId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from("ratings")
    .select("ratee_id")
    .eq("group_id", groupId)
    .eq("rater_id", user.id);
  return new Set((data ?? []).map((r) => r.ratee_id));
}
