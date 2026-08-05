import { skillParams, type SportId } from "./sports";

// NBA2K-style archetype derivation from a player's averaged skill profile.
// Basketball-only (SPORTS[sport].hasArchetype gates every call site) — works
// on raw skill-scale averages (all of basketball's 8 skills share a 1..5
// scale, so comparing raw means directly is meaningful; this would need
// rescaling first for a sport whose skills have mixed scales).

export type Averages = Record<string, number>;

export type ArchetypeResult = {
  archetype: string;
  tier: string;
  bestParam: string;
  worstParam: string;
  overall: number; // mean of the skill params, on their shared raw scale
};

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
  signals: Partial<Record<string, number>>;
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
  {
    name: "Do-It-All",
    signals: {
      shooting: 0.3, scoring: 0.3, dribbling: 0.3, rebounding: 0.3,
      passing: 0.3, defending: 0.3, physicality: 0.3, athleticism: 0.3,
    },
  },
];

export function computeArchetype(averages: Averages, sport: SportId): ArchetypeResult {
  const keys = skillParams(sport).map((p) => p.key);
  const vals = keys.map((k) => averages[k] ?? 0);
  const overall = vals.reduce((a, b) => a + b, 0) / (keys.length || 1);

  // z-ish: how much each param stands out above the player's own mean.
  const standout: Record<string, number> = {};
  for (const k of keys) standout[k] = (averages[k] ?? 0) - overall;

  let best: { name: string; score: number } = { name: "Do-It-All", score: -Infinity };
  for (const c of CANDIDATES) {
    let score = 0;
    let weightSum = 0;
    for (const [param, w] of Object.entries(c.signals) as [string, number][]) {
      score += w * ((averages[param] ?? 0) + standout[param] * 1.5);
      weightSum += w;
    }
    score = weightSum > 0 ? score / weightSum : score;
    if (score > best.score) best = { name: c.name, score };
  }

  let bestParam = keys[0];
  let worstParam = keys[0];
  for (const k of keys) {
    if ((averages[k] ?? 0) > (averages[bestParam] ?? 0)) bestParam = k;
    if ((averages[k] ?? 0) < (averages[worstParam] ?? 0)) worstParam = k;
  }

  return { archetype: best.name, tier: tierFor(overall), bestParam, worstParam, overall };
}
