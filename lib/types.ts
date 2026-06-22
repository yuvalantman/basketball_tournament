import type {
  RatingMode,
  StatsVisibility,
  TournamentStatus,
} from "./constants";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  height_cm: number | null;
  weight_kg: number | null;
  photo_url: string | null;
  created_at: string;
};

export type Tournament = {
  id: string;
  code: string;
  name: string;
  creator_id: string;
  rating_mode: RatingMode;
  stats_visibility: StatsVisibility;
  team_size: number;
  status: TournamentStatus;
  created_at: string;
};

export type TournamentPlayer = {
  tournament_id: string;
  user_id: string;
  joined_at: string;
  profile?: Profile;
};

export type Restriction = {
  id: string;
  tournament_id: string;
  player_a: string;
  player_b: string;
};

export type Team = {
  id: string;
  tournament_id: string;
  name: string;
  seed: number;
  members?: Profile[];
};

export type Game = {
  id: string;
  tournament_id: string;
  stage: "group" | "bracket";
  round: number;
  slot: number;
  team_a: string | null;
  team_b: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_team_id: string | null;
  next_game_id: string | null;
  next_slot: number | null;
};

// Aggregate stats returned by the get_player_stats RPC. Which fields are
// populated depends on stats_visibility + whether the caller is the creator.
export type PlayerStats = {
  user_id: string;
  username: string;
  display_name: string;
  photo_url: string | null;
  height_cm: number | null;
  // Full numeric averages (only when allowed to see numbers)
  averages: Record<string, number> | null;
  overall: number | null;
  // Normalized 0..1 per param (for radar shape, no raw numbers)
  normalized: Record<string, number> | null;
  // Archetype always present
  archetype: string | null;
  archetype_tier: string | null;
  best_param: string | null;
  worst_param: string | null;
  rating_mode: RatingMode;
};
