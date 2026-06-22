// Single source of truth for the rating parameters used across the whole app.
// Order here drives the order shown in the rating form, radar chart, and stats.

export const RATING_PARAMS = [
  "shooting",
  "scoring",
  "dribbling",
  "rebounding",
  "passing",
  "defending",
  "physicality",
  "athleticism",
] as const;

export type RatingParam = (typeof RATING_PARAMS)[number];

export const PARAM_LABELS: Record<RatingParam, string> = {
  shooting: "Shooting",
  scoring: "Scoring",
  dribbling: "Dribbling",
  rebounding: "Rebounding",
  passing: "Passing",
  defending: "Defending",
  physicality: "Physicality",
  athleticism: "Athleticism",
};

export const PARAM_ABBR: Record<RatingParam, string> = {
  shooting: "SHT",
  scoring: "SCR",
  dribbling: "DRB",
  rebounding: "REB",
  passing: "PAS",
  defending: "DEF",
  physicality: "PHY",
  athleticism: "ATH",
};

export type RatingMode = "eight" | "single";
export type StatsVisibility = "creator_only" | "everyone" | "radar_normalized";
export type TournamentStatus =
  | "lobby"
  | "rating"
  | "teams"
  | "bracket"
  | "done";
export type TeamSize = 2 | 3 | 5;

export const TEAM_SIZES: TeamSize[] = [2, 3, 5];

export const RATING_MODE_LABELS: Record<RatingMode, string> = {
  eight: "Detailed — 8 skills rated 1–5",
  single: "Simple — one overall score 1–10",
};

export const VISIBILITY_LABELS: Record<StatsVisibility, string> = {
  creator_only: "Only you (creator) see numbers; others see archetype + best/worst skill",
  everyone: "Everyone sees full average stats",
  radar_normalized: "Everyone sees a radar shape (no numbers)",
};

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  lobby: "Lobby",
  rating: "Rating",
  teams: "Teams",
  bracket: "Bracket",
  done: "Finished",
};

// Convert cm to a friendly feet'inches" string for display.
export function cmToFeet(cm: number | null | undefined): string {
  if (!cm) return "—";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  if (inches === 12) return `${feet + 1}'0"`;
  return `${feet}'${inches}"`;
}
