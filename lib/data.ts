import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  Game,
  Profile,
  Restriction,
  Team,
  Tournament,
} from "@/lib/types";

// RLS-bound reads used by Server Components. These only return rows the logged
// in user is allowed to see (members of the tournament, own profile, etc.).

export async function getMyProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data as Profile | null;
}

export async function getMyTournaments(): Promise<Tournament[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Tournaments where I'm a member (membership rows are visible to me).
  const { data: memberships } = await supabase
    .from("tournament_players")
    .select("tournament_id")
    .eq("user_id", user.id);
  const ids = (memberships ?? []).map((m) => m.tournament_id);
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: false });
  return (data ?? []) as Tournament[];
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as Tournament | null;
}

export async function getRoster(tournamentId: string): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_players")
    .select("profiles(*)")
    .eq("tournament_id", tournamentId);
  return (data ?? [])
    .map((r) => r.profiles as unknown as Profile)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export async function getRestrictions(
  tournamentId: string,
): Promise<Restriction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("restrictions")
    .select("*")
    .eq("tournament_id", tournamentId);
  return (data ?? []) as Restriction[];
}

export async function getTeams(tournamentId: string): Promise<Team[]> {
  const supabase = await createClient();
  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("seed");
  if (!teams || teams.length === 0) return [];

  const { data: members } = await supabase
    .from("team_members")
    .select("team_id, profiles(*)")
    .in(
      "team_id",
      teams.map((t) => t.id),
    );

  return teams.map((t) => ({
    ...(t as Team),
    members: (members ?? [])
      .filter((m) => m.team_id === t.id)
      .map((m) => m.profiles as unknown as Profile),
  }));
}

export async function getGames(tournamentId: string): Promise<Game[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("games")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("round")
    .order("slot");
  return (data ?? []) as Game[];
}

// Which players the current user has already rated (for the rating screen).
export async function getMyRatedSet(
  tournamentId: string,
): Promise<Set<string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from("ratings")
    .select("ratee_id")
    .eq("tournament_id", tournamentId)
    .eq("rater_id", user.id);
  return new Set((data ?? []).map((r) => r.ratee_id));
}
