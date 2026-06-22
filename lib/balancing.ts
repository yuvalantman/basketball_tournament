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
): BalanceResult {
  const n = players.length;
  const dims = players[0]?.features.length ?? 0;
  const numTeams = teamCountFor(n, teamSize);
  const sizes = teamSizes(n, numTeams);
  const restricted = new Set(restrictions.map(([a, b]) => pairKey(a, b)));

  // overall score (mean of features) used to seed a snake draft.
  const overall = players.map((p) =>
    p.features.reduce((a, b) => a + b, 0) / (p.features.length || 1),
  );

  let best: { teams: number[][]; cost: number; violations: number } | null = null;

  // Multiple restarts make the local search robust and let re-rolls differ.
  const RESTARTS = 40;
  for (let r = 0; r < RESTARTS; r++) {
    const rng = mulberry32(seed * 7919 + r * 104729 + 1);

    // Seed: snake draft by overall (restart 0), random order otherwise.
    let order: number[];
    if (r === 0) {
      order = players.map((_, i) => i).sort((a, b) => overall[b] - overall[a]);
    } else {
      order = shuffle(
        players.map((_, i) => i),
        rng,
      );
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

    const result = optimize(teams, players, restricted, dims);
    if (!best || result.cost < best.cost) best = result;
    // Perfect balance with no violations — unlikely to beat, stop early.
    if (best.violations === 0 && best.cost < 1e-6) break;
  }

  const final = best!;
  return {
    teams: final.teams.map((t) => t.map((pi) => players[pi].id)),
    cost: final.cost,
    restrictionViolations: final.violations,
  };
}
