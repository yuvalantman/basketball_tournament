// Server-side aggregation of anonymous peer ratings into per-player stats and
// balancing feature vectors. Pure functions: callers feed in the raw rows
// (read with the service role) and decide what to expose to the client.

import { RATING_PARAMS, type RatingMode, type RatingParam } from "./constants";
import { computeArchetype, singleScoreArchetype, type Averages } from "./archetype";
import type { PlayerStats, Profile } from "./types";

export type RatingRow = {
  ratee_id: string;
  shooting: number | null;
  scoring: number | null;
  dribbling: number | null;
  rebounding: number | null;
  passing: number | null;
  defending: number | null;
  physicality: number | null;
  athleticism: number | null;
  single_score: number | null;
};

export type PlayerAggregate = {
  userId: string;
  raterCount: number;
  averages: Averages | null; // 8-param mode
  singleAvg: number | null; // single mode
};

// Average each param over the raters who scored it (anonymous; we never track
// who gave what — only the ratee matters here).
export function aggregateRatings(
  ratings: RatingRow[],
  mode: RatingMode,
): Map<string, PlayerAggregate> {
  const byRatee = new Map<string, RatingRow[]>();
  for (const r of ratings) {
    const arr = byRatee.get(r.ratee_id) ?? [];
    arr.push(r);
    byRatee.set(r.ratee_id, arr);
  }

  const out = new Map<string, PlayerAggregate>();
  for (const [userId, rows] of byRatee) {
    if (mode === "single") {
      const vals = rows
        .map((r) => r.single_score)
        .filter((v): v is number => v != null);
      out.set(userId, {
        userId,
        raterCount: vals.length,
        averages: null,
        singleAvg: vals.length
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : null,
      });
    } else {
      const averages = {} as Averages;
      let raterCount = 0;
      for (const p of RATING_PARAMS) {
        const vals = rows
          .map((r) => r[p])
          .filter((v): v is number => v != null);
        averages[p] = vals.length
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : 0;
        raterCount = Math.max(raterCount, vals.length);
      }
      out.set(userId, { userId, raterCount, averages, singleAvg: null });
    }
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

// Build balancing feature vectors: every rated dimension PLUS height, each
// normalized across the pool so they're comparable. This is what makes the
// balancer spread shooters/tall players evenly, not just total strength.
export function buildFeatureVectors(
  players: Profile[],
  aggregates: Map<string, PlayerAggregate>,
  mode: RatingMode,
): FeatureVector[] {
  const heights = players.map((p) => p.height_cm ?? 0);
  const normHeights = normalize(heights);

  if (mode === "single") {
    const scores = players.map(
      (p) => aggregates.get(p.id)?.singleAvg ?? 0,
    );
    const normScores = normalize(scores);
    return players.map((p, i) => ({
      id: p.id,
      features: [normScores[i], normHeights[i] * 0.6], // height weighted a bit lower
    }));
  }

  // 8-param mode: normalize each param column across the pool.
  const columns: Record<RatingParam, number[]> = {} as Record<RatingParam, number[]>;
  for (const param of RATING_PARAMS) {
    columns[param] = normalize(
      players.map((p) => aggregates.get(p.id)?.averages?.[param] ?? 0),
    );
  }
  return players.map((p, i) => ({
    id: p.id,
    features: [
      ...RATING_PARAMS.map((param) => columns[param][i]),
      normHeights[i] * 0.6,
    ],
  }));
}

// Build the display payload, respecting stats_visibility + whether the viewer
// is the creator. Numbers are withheld unless the mode/role allows them.
export function buildPlayerStats(
  players: Profile[],
  aggregates: Map<string, PlayerAggregate>,
  mode: RatingMode,
  visibility: "creator_only" | "everyone" | "radar_normalized",
  isCreator: boolean,
): PlayerStats[] {
  // Pre-compute normalized columns for radar shapes (8-param mode only).
  const normColumns: Record<RatingParam, number[]> = {} as Record<RatingParam, number[]>;
  if (mode !== "single") {
    for (const param of RATING_PARAMS) {
      normColumns[param] = normalize(
        players.map((p) => aggregates.get(p.id)?.averages?.[param] ?? 0),
      );
    }
  }

  const showNumbers = visibility === "everyone" || isCreator;

  return players.map((p, idx) => {
    const agg = aggregates.get(p.id);
    const base = {
      user_id: p.id,
      username: p.username,
      display_name: p.display_name,
      photo_url: p.photo_url,
      height_cm: p.height_cm,
      rating_mode: mode,
      averages: null as Record<string, number> | null,
      overall: null as number | null,
      normalized: null as Record<string, number> | null,
      archetype: null as string | null,
      archetype_tier: null as string | null,
      best_param: null as string | null,
      worst_param: null as string | null,
    };

    if (!agg || agg.raterCount === 0) return base;

    if (mode === "single") {
      const a = singleScoreArchetype(agg.singleAvg ?? 0);
      base.archetype = a.archetype;
      base.archetype_tier = a.tier;
      if (showNumbers) base.overall = agg.singleAvg;
      return base;
    }

    const arch = computeArchetype(agg.averages!);
    base.archetype = arch.archetype;
    base.archetype_tier = arch.tier;
    // best/worst skill labels are always safe to show (no numbers).
    base.best_param = arch.bestParam;
    base.worst_param = arch.worstParam;

    if (showNumbers) {
      base.averages = { ...agg.averages };
      base.overall = arch.overall;
    }
    if (visibility === "radar_normalized" || showNumbers) {
      // radar shape (0..1) — no raw numbers leak through this.
      const normalized: Record<string, number> = {};
      for (const param of RATING_PARAMS) {
        normalized[param] = normColumns[param][idx];
      }
      base.normalized = normalized;
    }
    return base;
  });
}
