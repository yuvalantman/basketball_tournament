// Single source of truth for per-sport rating attributes. Every generalized
// module (rating UI, aggregation, balancing, radar chart, archetypes) reads
// from this file instead of hardcoding a sport's shape — adding a new sport
// or tweaking weights never requires touching code outside this file.

export type SportId = "basketball" | "soccer" | "volleyball";

export type SportParam = {
  key: string; // jsonb key in ratings.values + column-safe identifier
  label: string;
  abbr: string; // radar chart spoke label
  scaleMin: number;
  scaleMax: number;
  weight: number; // all of a sport's params sum to 1.0
  isOverall?: boolean; // at most one true per sport
};

export type SportConfig = {
  id: SportId;
  label: string;
  params: SportParam[]; // order = rating-form / radar / stats order
  hasArchetype: boolean;
};

export const SPORT_IDS: SportId[] = ["basketball", "soccer", "volleyball"];

export const SPORTS: Record<SportId, SportConfig> = {
  basketball: {
    id: "basketball",
    label: "Basketball",
    hasArchetype: true,
    // No dedicated "Overall" field — kept exactly as v1: a simple mean of 8
    // equally-weighted skills. Nothing is mandatory to save a rating.
    params: [
      { key: "shooting", label: "Shooting", abbr: "SHT", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "scoring", label: "Scoring", abbr: "SCR", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "dribbling", label: "Dribbling", abbr: "DRB", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "rebounding", label: "Rebounding", abbr: "REB", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "passing", label: "Passing", abbr: "PAS", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "defending", label: "Defending", abbr: "DEF", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "physicality", label: "Physicality", abbr: "PHY", scaleMin: 1, scaleMax: 5, weight: 0.125 },
      { key: "athleticism", label: "Athleticism", abbr: "ATH", scaleMin: 1, scaleMax: 5, weight: 0.125 },
    ],
  },
  volleyball: {
    id: "volleyball",
    label: "Volleyball",
    hasArchetype: false,
    params: [
      { key: "overall", label: "Overall", abbr: "OVR", scaleMin: 1, scaleMax: 10, weight: 0.3, isOverall: true },
      { key: "spiking", label: "Spiking", abbr: "SPK", scaleMin: 1, scaleMax: 5, weight: 0.15 },
      { key: "passing", label: "Passing", abbr: "PAS", scaleMin: 1, scaleMax: 5, weight: 0.15 },
      { key: "serving", label: "Serving", abbr: "SRV", scaleMin: 1, scaleMax: 5, weight: 0.12 },
      { key: "setting", label: "Setting", abbr: "SET", scaleMin: 1, scaleMax: 5, weight: 0.1 },
      { key: "athleticism", label: "Athleticism", abbr: "ATH", scaleMin: 1, scaleMax: 5, weight: 0.1 },
      { key: "blocking", label: "Blocking", abbr: "BLK", scaleMin: 1, scaleMax: 5, weight: 0.08 },
    ],
  },
  soccer: {
    id: "soccer",
    label: "Soccer",
    hasArchetype: false,
    params: [
      { key: "overall", label: "Overall", abbr: "OVR", scaleMin: 1, scaleMax: 10, weight: 0.3, isOverall: true },
      { key: "shooting", label: "Shooting", abbr: "SHT", scaleMin: 1, scaleMax: 5, weight: 0.15 },
      { key: "passing", label: "Passing", abbr: "PAS", scaleMin: 1, scaleMax: 5, weight: 0.15 },
      { key: "defending", label: "Defending", abbr: "DEF", scaleMin: 1, scaleMax: 5, weight: 0.15 },
      { key: "dribbling", label: "Dribbling", abbr: "DRB", scaleMin: 1, scaleMax: 5, weight: 0.1 },
      { key: "pace", label: "Pace", abbr: "PAC", scaleMin: 1, scaleMax: 5, weight: 0.1 },
      { key: "physicality", label: "Physicality", abbr: "PHY", scaleMin: 1, scaleMax: 5, weight: 0.05 },
    ],
  },
};

export const SPORT_LABELS: Record<SportId, string> = {
  basketball: "Basketball",
  soccer: "Soccer",
  volleyball: "Volleyball",
};

// The param flagged isOverall, if this sport has one (basketball doesn't).
export function overallParam(sport: SportId): SportParam | undefined {
  return SPORTS[sport].params.find((p) => p.isOverall);
}

// Skill params only — excludes the dedicated Overall field, if any. This is
// what archetype scoring and "best/worst skill" should look at, since
// Overall is a holistic score rather than a standout skill.
export function skillParams(sport: SportId): SportParam[] {
  return SPORTS[sport].params.filter((p) => !p.isOverall);
}

export function paramByKey(sport: SportId, key: string): SportParam | undefined {
  return SPORTS[sport].params.find((p) => p.key === key);
}
