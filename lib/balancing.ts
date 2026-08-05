// Multi-dimensional team balancing.
//
// Goal (from the plan): teams that are even across EVERY dimension — not just
// total strength. We balance each of the 8 rated skills AND height, so you
// won't end up with all the shooters or all the tall players on one team.
// Restrictions ("these two can't be on the same team") are honored.

export type BalancePlayer = {
  id: string;
  // Feature vector already normalized to 0..1 per dimension, in a stable order.
  // (e.g. [shooting, scoring, ..., athleticism, height])
  features: number[];
};

export type BalanceResult = {
  teams: string[][]; // arrays of player ids
  cost: number; // lower = more balanced
  restrictionViolations: number; // 0 means all restrictions satisfied
};

// Big penalty so the optimizer treats keeping a restricted pair apart as far
// more important than fine-grained balance.
const RESTRICTION_PENALTY = 1000;

// Deterministic-ish RNG so a given seed reproduces a layout (re-roll changes
// the seed to get a different valid layout).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Number of teams for N players at a target team size, sizes differ by <= 1.
export function teamCountFor(numPlayers: number, teamSize: number): number {
  return Math.max(2, Math.round(numPlayers / teamSize));
}

// Team sizes: base size with the remainder spread one-per-team.
function teamSizes(numPlayers: number, numTeams: number): number[] {
  const base = Math.floor(numPlayers / numTeams);
  const rem = numPlayers - base * numTeams;
  return Array.from({ length: numTeams }, (_, i) => base + (i < rem ? 1 : 0));
}

// Gameday team sizes: unlike teamCountFor/teamSizes above (which rounds to
// the NEAREST team count, e.g. 16 players @ size 6 -> 3 teams of ~5), a
// gameday keeps exactly the number of FULL teams the chosen size implies and
// pushes any remainder in as reserves on top of that (16 @ size 6 -> 2 teams
// of 8, i.e. 6 core + 2 reserves each). The core balancing optimizer already
// works on per-team MEANS, not sums, so a team with extra reserves doesn't
// look artificially stronger/weaker purely from headcount — no change needed
// there, only in how many players end up on each team.
export function gamedayTeamSizes(
  numPlayers: number,
  teamSize: number,
): { numTeams: number; sizes: number[] } {
  const numTeams = Math.max(2, Math.floor(numPlayers / teamSize));
  const core = Math.floor(numPlayers / numTeams);
  const remainder = numPlayers - core * numTeams;
  const sizes = Array.from({ length: numTeams }, (_, i) => core + (i < remainder ? 1 : 0));
  return { numTeams, sizes };
}

function cost(
  teams: number[][],
  players: BalancePlayer[],
  restricted: Set<string>,
  dims: number,
): { cost: number; violations: number } {
  // Per-dimension variance of team averages across teams.
  let total = 0;
  for (let d = 0; d < dims; d++) {
    const means: number[] = [];
    for (const team of teams) {
      if (team.length === 0) {
        means.push(0);
        continue;
      }
      let s = 0;
      for (const pi of team) s += players[pi].features[d];
      means.push(s / team.length);
    }
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    let v = 0;
    for (const m of means) v += (m - mean) ** 2;
    total += v / means.length;
  }

  // Restriction violations: restricted pair sharing a team.
  let violations = 0;
  for (const team of teams) {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const a = players[team[i]].id;
        const b = players[team[j]].id;
        if (restricted.has(pairKey(a, b))) violations++;
      }
    }
  }

  return { cost: total + violations * RESTRICTION_PENALTY, violations };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Local search: repeatedly swap two players on different teams if it lowers
// cost. Swaps preserve team sizes. Runs to a local optimum.
function optimize(
  initial: number[][],
  players: BalancePlayer[],
  restricted: Set<string>,
  dims: number,
): { teams: number[][]; cost: number; violations: number } {
  const teams = initial.map((t) => t.slice());
  let current = cost(teams, players, restricted, dims);

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 5000) {
    improved = false;
    for (let ta = 0; ta < teams.length; ta++) {
      for (let tb = ta + 1; tb < teams.length; tb++) {
        for (let ia = 0; ia < teams[ta].length; ia++) {
          for (let ib = 0; ib < teams[tb].length; ib++) {
            // Try swapping.
            const pa = teams[ta][ia];
            const pb = teams[tb][ib];
            teams[ta][ia] = pb;
            teams[tb][ib] = pa;
            const next = cost(teams, players, restricted, dims);
            if (next.cost < current.cost - 1e-9) {
              current = next;
              improved = true;
            } else {
              // revert
              teams[ta][ia] = pa;
              teams[tb][ib] = pb;
            }
          }
        }
      }
    }
  }
  return { teams, cost: current.cost, violations: current.violations };
}

export function balanceTeams(
  players: BalancePlayer[],
  teamSize: number,
  restrictions: [string, string][],
  seed = 1,
  // Gamedays pass gamedayTeamSizes(...)'s sizes explicitly (reserve-aware,
  // exact team count); omitted, falls back to the round-to-nearest v1
  // behavior (teamCountFor/teamSizes) still used by scripts/test-balance.ts.
  explicitSizes?: number[],
): BalanceResult {
  const n = players.length;
  const dims = players[0]?.features.length ?? 0;
  const numTeams = explicitSizes ? explicitSizes.length : teamCountFor(n, teamSize);
  const sizes = explicitSizes ?? teamSizes(n, numTeams);
  const restricted = new Set(restrictions.map(([a, b]) => pairKey(a, b)));

  // overall score (mean of features) used to seed a snake draft.
  const overall = players.map((p) =>
    p.features.reduce((a, b) => a + b, 0) / (p.features.length || 1),
  );

  // Multiple restarts are meant to make re-rolls differ — but empirically,
  // the pairwise-swap local search is such a strong basin of attraction that
  // EVERY restart (any starting shuffle) converges to the exact same
  // partition, regardless of seed (confirmed by testing: 40 restarts, 10
  // different seeds, identical result every time). So instead of optimizing
  // the true feature vectors directly on every restart, each restart
  // optimizes a slightly seeded-jittered copy of them — nudging the search
  // toward a genuinely different nearby optimum per restart/seed — and we
  // then score every candidate against the TRUE (unperturbed) cost function,
  // so quality is never judged by the jittered landscape, only the real one.
  const candidates: { teams: number[][]; cost: number; violations: number }[] = [];
  const RESTARTS = 40;
  const JITTER = 0.18;
  for (let r = 0; r < RESTARTS; r++) {
    const rng = mulberry32(seed * 7919 + r * 104729 + 1);

    const jittered: BalancePlayer[] =
      r === 0
        ? players // keep one restart on the true landscape as a quality anchor
        : players.map((p) => ({
            ...p,
            features: p.features.map((f) => f + (rng() - 0.5) * JITTER),
          }));
    const jitteredOverall = jittered.map(
      (p) => p.features.reduce((a, b) => a + b, 0) / (p.features.length || 1),
    );

    // Seed: snake draft by overall (restart 0), random order otherwise.
    let order: number[];
    if (r === 0) {
      order = players.map((_, i) => i).sort((a, b) => overall[b] - overall[a]);
    } else {
      order = players.map((_, i) => i).sort((a, b) => jitteredOverall[b] - jitteredOverall[a]);
      order = shuffle(order, rng);
    }

    const teams: number[][] = sizes.map(() => []);
    // Snake/serpentine fill respecting capacities.
    let dir = 1;
    let t = 0;
    for (const pi of order) {
      // find next team with remaining capacity in serpentine direction
      let placed = false;
      for (let step = 0; step < numTeams * 2 && !placed; step++) {
        if (teams[t].length < sizes[t]) {
          teams[t].push(pi);
          placed = true;
        }
        t += dir;
        if (t >= numTeams) {
          t = numTeams - 1;
          dir = -1;
        } else if (t < 0) {
          t = 0;
          dir = 1;
        }
      }
      if (!placed) {
        // fallback: drop into any team with space
        const idx = teams.findIndex((tm, k) => tm.length < sizes[k]);
        if (idx >= 0) teams[idx].push(pi);
      }
    }

    // Optimize against the (possibly jittered) landscape, then re-score the
    // resulting partition against the TRUE features for fair comparison.
    const result = optimize(teams, jittered, restricted, dims);
    const trueScore = cost(result.teams, players, restricted, dims);
    candidates.push({ teams: result.teams, cost: trueScore.cost, violations: trueScore.violations });
  }

  // De-duplicate by the actual partition (not just cost) FIRST, keeping each
  // distinct partition's best score — otherwise whichever partition is
  // easiest for the local search to reach dominates the candidate pool by
  // sheer repetition and the "random" pick is really just biased toward it.
  // Then take an epsilon-pool of the near-optimal DISTINCT partitions and
  // pick uniformly among them. Any candidate in the pool necessarily still
  // has zero restriction violations if the best one does (the penalty is
  // 1000, far above the epsilon window), so this never trades away
  // restriction correctness for variety.
  const bestByPartition = new Map<string, { teams: number[][]; cost: number; violations: number }>();
  for (const c of candidates) {
    const sig = c.teams.map((t) => [...t].sort().join(",")).sort().join("|");
    const existing = bestByPartition.get(sig);
    if (!existing || c.cost < existing.cost) bestByPartition.set(sig, c);
  }
  const distinct = [...bestByPartition.values()].sort((a, b) => a.cost - b.cost);
  const bestCost = distinct[0].cost;
  const epsilon = Math.max(bestCost * 0.4, 0.02);
  const pool = distinct.filter((c) => c.cost <= bestCost + epsilon);
  if (process.env.DEBUG_BALANCE) {
    console.log(
      "DEBUG distinct partitions:",
      distinct.length,
      "costs:",
      distinct.map((c) => c.cost.toFixed(4)).join(","),
      "poolSize=",
      pool.length,
    );
  }
  const pickRng = mulberry32(seed * 15485863 + 1);
  const final = pool[Math.floor(pickRng() * pool.length)];

  return {
    teams: final.teams.map((t) => t.map((pi) => players[pi].id)),
    cost: final.cost,
    restrictionViolations: final.violations,
  };
}
