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

// Rating coverage rule: every player must rate, and be rated by, at least this
// many others before teams can be built. Capped at the number of other players
// when the group is smaller than the threshold.
export const MIN_RATINGS = 7;

export function requiredRatings(playerCount: number): number {
  return Math.min(MIN_RATINGS, Math.max(0, playerCount - 1));
}

// Map a raw average to the 70–100 "OVR" scale shown for each player.
//   eight-param mode: raw mean is 1..5
//   single mode:      raw score is 1..10
// Both are linearly rescaled so the floor is 70 and a perfect score is 100.
export function overallTo100(raw: number, mode: RatingMode): number {
  const [min, max] = mode === "single" ? [1, 10] : [1, 5];
  const clamped = Math.max(min, Math.min(max, raw));
  return Math.round(70 + ((clamped - min) / (max - min)) * 30);
}

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
