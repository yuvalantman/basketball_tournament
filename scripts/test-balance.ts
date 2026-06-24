// Offline test of the team-balancing + bracket logic. No database required.
//   npm run test:balance
import { balanceTeams, teamCountFor, type BalancePlayer } from "../lib/balancing";
import {
  computeStandings,
  planInitialSchedule,
  randomKnockout4,
} from "../lib/bracket";
import { computeArchetype } from "../lib/archetype";
import { RATING_PARAMS } from "../lib/constants";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failures++;
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build N players with random normalized feature vectors (8 skills + height).
function makePlayers(n: number, seed: number): BalancePlayer[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    features: Array.from({ length: 9 }, () => r()),
  }));
}

// Spread (stddev of team means) for one dimension — should be small.
function dimSpread(teams: string[][], players: BalancePlayer[], d: number) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const means = teams.map((t) => {
    if (!t.length) return 0;
    return t.reduce((s, id) => s + byId.get(id)!.features[d], 0) / t.length;
  });
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  return Math.sqrt(
    means.reduce((s, m) => s + (m - mean) ** 2, 0) / means.length,
  );
}

console.log("\n=== Team balancing ===");
{
  const players = makePlayers(12, 42);
  const res = balanceTeams(players, 3, [], 7);
  assert(res.teams.length === teamCountFor(12, 3), "12 players / size 3 -> 4 teams");
  assert(
    res.teams.every((t) => t.length === 3),
    "all teams have 3 players",
  );
  const all = res.teams.flat();
  assert(new Set(all).size === 12, "every player placed exactly once");

  // Every dimension should be reasonably even, not just overall.
  let maxSpread = 0;
  for (let d = 0; d < 9; d++)
    maxSpread = Math.max(maxSpread, dimSpread(res.teams, players, d));
  console.log(`    max per-dimension spread: ${maxSpread.toFixed(3)}`);
  assert(maxSpread < 0.25, "no single skill/height is lopsided across teams");
}

console.log("\n=== Restrictions honored ===");
{
  const players = makePlayers(10, 99);
  // Force several keep-apart pairs.
  const restrictions: [string, string][] = [
    ["p0", "p1"],
    ["p2", "p3"],
    ["p4", "p5"],
  ];
  const res = balanceTeams(players, 2, restrictions, 3);
  const sameTeam = (a: string, b: string) =>
    res.teams.some((t) => t.includes(a) && t.includes(b));
  for (const [a, b] of restrictions)
    assert(!sameTeam(a, b), `${a} and ${b} kept on different teams`);
  assert(res.restrictionViolations === 0, "reported zero restriction violations");
}

console.log("\n=== Uneven player counts ===");
{
  const players = makePlayers(7, 5);
  const res = balanceTeams(players, 3, [], 1);
  const sizes = res.teams.map((t) => t.length).sort();
  console.log(`    team sizes: ${sizes.join(", ")}`);
  assert(
    Math.max(...sizes) - Math.min(...sizes) <= 1,
    "team sizes differ by at most 1",
  );
  assert(res.teams.flat().length === 7, "all 7 players placed");
}

console.log("\n=== Bracket: exactly 4 teams ===");
{
  const plan = planInitialSchedule(["A", "B", "C", "D"], 1);
  assert(plan.kind === "knockout", "4 teams -> straight knockout");
  const semis = plan.games.filter((g) => g.round === 1);
  assert(semis.length === 2, "two semifinals");
  assert(
    plan.games.some((g) => g.label === "Final"),
    "has a final",
  );
}

console.log("\n=== Bracket: 6 teams -> full round robin (5 games each) ===");
{
  const teamIds = ["A", "B", "C", "D", "E", "F"];
  const plan = planInitialSchedule(teamIds, 1);
  assert(plan.kind === "group", "6 teams -> round robin group stage");
  // full round robin: each team plays every other once = 5 games each, 15 total
  const counts = new Map<string, number>();
  for (const g of plan.games) {
    counts.set(g.teamA!, (counts.get(g.teamA!) ?? 0) + 1);
    counts.set(g.teamB!, (counts.get(g.teamB!) ?? 0) + 1);
  }
  assert(
    [...counts.values()].every((c) => c === 5),
    "every team plays exactly 5 group games",
  );
  assert(plan.games.length === 15, "6 teams -> 15 total round-robin games");
  // every pairing is unique (true round robin, no repeats)
  const pairs = new Set(
    plan.games.map((g) => [g.teamA, g.teamB].sort().join("-")),
  );
  assert(pairs.size === 15, "all 15 pairings are unique");
  // 5 matchdays, 3 games each
  const byRound = new Map<number, number>();
  for (const g of plan.games)
    byRound.set(g.round, (byRound.get(g.round) ?? 0) + 1);
  assert(byRound.size === 5, "scheduled into 5 matchdays");
  assert(
    [...byRound.values()].every((c) => c === 3),
    "each matchday has 3 games",
  );

  // Fake some results and check top-4 selection + random bracket.
  const games = plan.games.map((g, i) => ({
    team_a: g.teamA,
    team_b: g.teamB,
    score_a: 11,
    score_b: i % 2, // team_a always wins by varying margin
  }));
  const standings = computeStandings(teamIds, games);
  assert(standings.length === 6, "standings cover all teams");
  const top4 = standings.slice(0, 4).map((s) => s.teamId);
  const bracket = randomKnockout4(top4, 123);
  assert(
    bracket.filter((g) => g.round === 1).length === 2,
    "top-4 produce 2 semifinals",
  );
}

console.log("\n=== Bracket: 7 teams -> 7 matchdays, one team rests each ===");
{
  const teamIds = ["A", "B", "C", "D", "E", "F", "G"];
  const plan = planInitialSchedule(teamIds, 1);
  // Full round robin for 7 teams: each plays the other 6 = 6 games, C(7,2)=21.
  const counts = new Map<string, number>();
  for (const g of plan.games) {
    counts.set(g.teamA!, (counts.get(g.teamA!) ?? 0) + 1);
    counts.set(g.teamB!, (counts.get(g.teamB!) ?? 0) + 1);
  }
  assert(
    [...counts.values()].every((c) => c === 6),
    "every team plays exactly 6 games",
  );
  assert(plan.games.length === 21, "7 teams -> 21 total games");
  // 7 matchdays, 3 games each (one team rests per round = the bye).
  const byRound = new Map<number, number>();
  for (const g of plan.games)
    byRound.set(g.round, (byRound.get(g.round) ?? 0) + 1);
  assert(byRound.size === 7, "scheduled into 7 matchdays");
  assert(
    [...byRound.values()].every((c) => c === 3),
    "each matchday has 3 games (1 of 7 teams rests)",
  );
  // Each team rests exactly once across the 7 rounds.
  const playsPerTeam = new Map<string, Set<number>>();
  for (const g of plan.games) {
    for (const t of [g.teamA!, g.teamB!]) {
      (playsPerTeam.get(t) ?? playsPerTeam.set(t, new Set()).get(t)!).add(
        g.round,
      );
    }
  }
  assert(
    [...playsPerTeam.values()].every((rounds) => rounds.size === 6),
    "each team plays in 6 of 7 rounds (rests exactly once)",
  );
}

console.log("\n=== Archetypes ===");
{
  const sharp = Object.fromEntries(
    RATING_PARAMS.map((p) => [p, p === "shooting" ? 5 : 2]),
  ) as Record<(typeof RATING_PARAMS)[number], number>;
  const a = computeArchetype(sharp);
  console.log(`    pure shooter -> ${a.archetype} (${a.tier})`);
  assert(a.bestParam === "shooting", "best param is shooting for a pure shooter");

  const big = Object.fromEntries(
    RATING_PARAMS.map((p) => [
      p,
      p === "rebounding" || p === "physicality" ? 5 : 2,
    ]),
  ) as Record<(typeof RATING_PARAMS)[number], number>;
  const b = computeArchetype(big);
  console.log(`    rebound+physical -> ${b.archetype} (${b.tier})`);
  assert(
    ["Glass Cleaner", "Enforcer"].includes(b.archetype),
    "rebound/physical big gets a big-man archetype",
  );
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("✅ All balancing/bracket/archetype checks passed.");
}
