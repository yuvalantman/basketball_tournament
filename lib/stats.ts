// Server-side aggregation of anonymous peer ratings into per-player stats and
// balancing feature vectors. Pure functions: callers feed in the raw rows
// (read with the service role) and decide what to expose to the client.
//
// No per-sport branching here — every sport is just SPORTS[sport].params
// (see lib/sports.ts), each with its own weight + scale. "No minimum
// ratings" falls out naturally: score01 renormalizes weights over only the
// attributes that were actually rated, so a player rated on one attribute
// alone still gets a fair score instead of being dragged toward 0.

import { computeArchetype } from "./archetype";
import { skillParams, type SportConfig } from "./sports";
import type { DisplayOptions, Gender } from "./constants";
import type { PlayerCard } from "./types";

export type RatingRow = {
  rater_id: string;
  ratee_id: string;
  values: Record<string, number>;
  weight: number;
};

export type PlayerAggregate = {
  userId: string;
  // Per-attribute weighted mean (on the attribute's own raw scale) + a plain
  // headcount of distinct ratings that included this attribute (NOT
  // weight-inflated — weight only affects the mean, the count is for
  // display/inspection).
  perParam: Record<string, { weightedMean: number; raterCount: number }>;
  // Weighted, cross-attribute score, 0..1, renormalized over present attrs.
  score01: number | null;
  // Distinct raters who rated this player on ANYTHING.
  raterCount: number;
};

export function aggregateRatings(
  rows: RatingRow[],
  sport: SportConfig,
): Map<string, PlayerAggregate> {
  const byRatee = new Map<string, RatingRow[]>();
  for (const r of rows) {
    const arr = byRatee.get(r.ratee_id) ?? [];
    arr.push(r);
    byRatee.set(r.ratee_id, arr);
  }

  const out = new Map<string, PlayerAggregate>();
  for (const [userId, ratingsForPlayer] of byRatee) {
    const perParam: Record<string, { weightedMean: number; raterCount: number }> = {};
    let weightedScoreSum = 0;
    let weightSumUsed = 0;
    const raterIds = new Set<string>();

    for (const param of sport.params) {
      let sumWV = 0;
      let sumW = 0;
      let count = 0;
      for (const row of ratingsForPlayer) {
        const v = row.values[param.key];
        if (v == null) continue;
        sumWV += v * row.weight;
        sumW += row.weight;
        count++;
      }
      if (count > 0) {
        const mean = sumWV / sumW;
        perParam[param.key] = { weightedMean: mean, raterCount: count };
        const own01 = (mean - param.scaleMin) / (param.scaleMax - param.scaleMin);
        weightedScoreSum += param.weight * own01;
        weightSumUsed += param.weight;
      }
    }

    for (const row of ratingsForPlayer) {
      if (Object.keys(row.values).length > 0) raterIds.add(row.rater_id);
    }

    out.set(userId, {
      userId,
      perParam,
      score01: weightSumUsed > 0 ? weightedScoreSum / weightSumUsed : null,
      raterCount: raterIds.size,
    });
  }
  return out;
}

// Min-max normalize a list of values to 0..1 (0.5 if all equal).
function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

export type FeatureVector = { id: string; features: number[] };

export type BalanceablePlayer = {
  id: string;
  height_cm: number | null;
  gender: Gender | null;
};

// Build balancing feature vectors: every rated dimension, PLUS the player's
// overall score01, PLUS height, PLUS gender — all normalized across the pool
// so they're comparable. Height/gender are soft-balanced (spread evenly
// across team means) at reduced weight, same treatment as v1's height-only
// dimension.
export function buildFeatureVectors(
  players: BalanceablePlayer[],
  aggregates: Map<string, PlayerAggregate>,
  sport: SportConfig,
): FeatureVector[] {
  const heights = players.map((p) => p.height_cm ?? 0);
  const normHeights = normalize(heights);
  const genderDim = players.map((p) => (p.gender === "M" ? 1 : p.gender === "F" ? 0 : 0.5));

  const paramColumns: Record<string, number[]> = {};
  for (const param of sport.params) {
    const mid = (param.scaleMin + param.scaleMax) / 2;
    paramColumns[param.key] = normalize(
      players.map((p) => aggregates.get(p.id)?.perParam[param.key]?.weightedMean ?? mid),
    );
  }

  const overallColumn = normalize(players.map((p) => aggregates.get(p.id)?.score01 ?? 0.5));

  return players.map((p, i) => ({
    id: p.id,
    features: [
      ...sport.params.map((param) => paramColumns[param.key][i]),
      overallColumn[i],
      normHeights[i] * 0.6,
      genderDim[i] * 0.4,
    ],
  }));
}

export type CardSubject = {
  id: string;
  username: string;
  display_name: string;
  photo_url: string | null;
  height_cm: number | null;
  gender: Gender | null;
};

// Build the display payload, gating each visual block independently off the
// group's display_options. Numbers are always the 70–100 scale, never a raw
// 1-5/1-10 value.
export function buildPlayerCards(
  players: CardSubject[],
  aggregates: Map<string, PlayerAggregate>,
  sport: SportConfig,
  displayOptions: DisplayOptions,
  scoreToDisplay: (score01: number) => number,
): PlayerCard[] {
  // Pool-normalized columns, for the radar shape only (relative shape within
  // this group — distinct from the per-attribute "averages" display, which
  // uses the attribute's OWN scale, not a pool-relative one).
  const poolColumns: Record<string, number[]> = {};
  for (const param of sport.params) {
    const mid = (param.scaleMin + param.scaleMax) / 2;
    poolColumns[param.key] = normalize(
      players.map((p) => aggregates.get(p.id)?.perParam[param.key]?.weightedMean ?? mid),
    );
  }

  return players.map((p, idx) => {
    const agg = aggregates.get(p.id);
    const base: PlayerCard = {
      user_id: p.id,
      username: p.username,
      display_name: p.display_name,
      photo_url: p.photo_url,
      height_cm: p.height_cm,
      gender: p.gender,
      sport: sport.id,
      averages: null,
      overall: null,
      normalized: null,
      archetype: null,
      archetype_tier: null,
      best_param: null,
      worst_param: null,
      raterCount: agg?.raterCount ?? 0,
    };

    if (!agg || agg.raterCount === 0) return base;

    if (displayOptions.overall && agg.score01 != null) {
      base.overall = scoreToDisplay(agg.score01);
    }

    if (displayOptions.averages) {
      const averages: Record<string, number> = {};
      for (const param of sport.params) {
        const entry = agg.perParam[param.key];
        if (!entry) continue;
        const own01 = (entry.weightedMean - param.scaleMin) / (param.scaleMax - param.scaleMin);
        averages[param.key] = scoreToDisplay(own01);
      }
      base.averages = averages;
    }

    if (displayOptions.radar) {
      const normalized: Record<string, number> = {};
      for (const param of sport.params) {
        normalized[param.key] = poolColumns[param.key][idx];
      }
      base.normalized = normalized;
    }

    if (displayOptions.best_worst || displayOptions.archetype) {
      const skills = skillParams(sport.id).map((sp) => sp.key);
      // Compare on each skill's OWN scale (0..1) so mixed-scale sports
      // (e.g. a 1-10 Overall next to 1-5 skills) never bias the comparison
      // — but archetype/best-worst only ever look at skill params anyway.
      const rawAverages: Record<string, number> = {};
      for (const key of skills) {
        rawAverages[key] = agg.perParam[key]?.weightedMean ?? 0;
      }
      const hasAnySkillRating = skills.some((k) => agg.perParam[k]);
      if (hasAnySkillRating) {
        if (displayOptions.best_worst) {
          let bestKey = skills[0];
          let worstKey = skills[0];
          for (const k of skills) {
            if (rawAverages[k] > rawAverages[bestKey]) bestKey = k;
            if (rawAverages[k] < rawAverages[worstKey]) worstKey = k;
          }
          base.best_param = bestKey;
          base.worst_param = worstKey;
        }
        if (displayOptions.archetype && sport.hasArchetype) {
          const arch = computeArchetype(rawAverages, sport.id);
          base.archetype = arch.archetype;
          base.archetype_tier = arch.tier;
        }
      }
    }

    return base;
  });
}
