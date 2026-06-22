import { PARAM_LABELS, RATING_PARAMS, type RatingParam } from "./constants";

// NBA2K-style archetype derivation from a player's averaged 8-param profile.
// Works on raw 1..5 averages. Pure function — reused by stats + matchup cards.

export type Averages = Record<RatingParam, number>;

export type ArchetypeResult = {
  archetype: string;
  tier: string; // overall tier label
  bestParam: RatingParam;
  worstParam: RatingParam;
  overall: number; // mean of the 8 params (1..5)
};

// Overall tier from the 1..5 mean.
function tierFor(overall: number): string {
  if (overall >= 4.3) return "Superstar";
  if (overall >= 3.8) return "Franchise";
  if (overall >= 3.2) return "Starter";
  if (overall >= 2.5) return "Role Player";
  return "Benchwarmer";
}

// Each candidate archetype scores itself against the profile; the highest
// scoring one wins. Scores reward the named strengths being high relative to
// the player's own average, so archetypes reflect what a player is *known for*.
type Candidate = {
  name: string;
  // params that define this archetype + a weight
  signals: Partial<Record<RatingParam, number>>;
};

const CANDIDATES: Candidate[] = [
  { name: "Sharpshooter", signals: { shooting: 1.0 } },
  { name: "Slasher", signals: { scoring: 0.7, dribbling: 0.7, athleticism: 0.4 } },
  { name: "Shot Creator", signals: { scoring: 0.8, dribbling: 0.8, shooting: 0.4 } },
  { name: "Floor General", signals: { passing: 1.0, dribbling: 0.5 } },
  { name: "Point Forward", signals: { passing: 0.7, scoring: 0.6, physicality: 0.4 } },
  { name: "Lockdown Defender", signals: { defending: 1.0, athleticism: 0.4 } },
  { name: "Glass Cleaner", signals: { rebounding: 1.0, physicality: 0.5 } },
  { name: "Enforcer", signals: { physicality: 0.9, rebounding: 0.6, defending: 0.4 } },
  { name: "Athletic Freak", signals: { athleticism: 0.9, physicality: 0.6 } },
  { name: "Two-Way Wing", signals: { defending: 0.6, scoring: 0.5, shooting: 0.4, athleticism: 0.3 } },
  { name: "Three-and-D", signals: { shooting: 0.7, defending: 0.7 } },
  { name: "Do-It-All", signals: { shooting: 0.3, scoring: 0.3, dribbling: 0.3, rebounding: 0.3, passing: 0.3, defending: 0.3, physicality: 0.3, athleticism: 0.3 } },
];

export function computeArchetype(averages: Averages): ArchetypeResult {
  const vals = RATING_PARAMS.map((p) => averages[p] ?? 0);
  const overall = vals.reduce((a, b) => a + b, 0) / RATING_PARAMS.length;

  // z-ish: how much each param stands out above the player's own mean.
  const standout: Record<RatingParam, number> = {} as Record<RatingParam, number>;
  for (const p of RATING_PARAMS) {
    standout[p] = (averages[p] ?? 0) - overall;
  }

  let best: { name: string; score: number } = { name: "Do-It-All", score: -Infinity };
  for (const c of CANDIDATES) {
    let score = 0;
    let weightSum = 0;
    for (const [param, w] of Object.entries(c.signals) as [RatingParam, number][]) {
      // Reward both absolute strength and standing out from own baseline.
      score += w * ((averages[param] ?? 0) + standout[param] * 1.5);
      weightSum += w;
    }
    score = weightSum > 0 ? score / weightSum : score;
    if (score > best.score) best = { name: c.name, score };
  }

  // Find best/worst individual param.
  let bestParam: RatingParam = RATING_PARAMS[0];
  let worstParam: RatingParam = RATING_PARAMS[0];
  for (const p of RATING_PARAMS) {
    if ((averages[p] ?? 0) > (averages[bestParam] ?? 0)) bestParam = p;
    if ((averages[p] ?? 0) < (averages[worstParam] ?? 0)) worstParam = p;
  }

  return {
    archetype: best.name,
    tier: tierFor(overall),
    bestParam,
    worstParam,
    overall,
  };
}

// For single-score (1..10) mode there are no per-skill params — the archetype
// is purely a tier label derived from the single overall score.
export function singleScoreArchetype(score: number): {
  archetype: string;
  tier: string;
} {
  if (score >= 9) return { archetype: "Superstar", tier: "Superstar" };
  if (score >= 7.5) return { archetype: "Franchise Player", tier: "Franchise" };
  if (score >= 6) return { archetype: "Starter", tier: "Starter" };
  if (score >= 4) return { archetype: "Role Player", tier: "Role Player" };
  return { archetype: "Benchwarmer", tier: "Benchwarmer" };
}

export function paramLabel(p: string): string {
  return PARAM_LABELS[p as RatingParam] ?? p;
}
