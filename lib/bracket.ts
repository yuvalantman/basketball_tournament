// Tournament scheduling logic (pure).
//
// Rules from the plan:
//  - Exactly 4 teams  -> straight bracket: 2 semifinals -> final (+ 3rd place).
//  - More than 4 teams -> group stage: each team plays exactly 2 games (to 11),
//    rank by wins then point differential, top 4 advance to a RANDOM bracket.
//  - 2 teams -> a single final. 3 teams -> round robin, best record wins.

export type GameSpec = {
  stage: "group" | "bracket";
  round: number; // 0 = group, 1 = semifinal, 2 = final/3rd
  slot: number; // index within the round
  teamA: string | null;
  teamB: string | null;
  label: string;
  // Where this game's WINNER advances to (matched by round+slot).
  winnerFeeds?: { round: number; slot: number; position: "a" | "b" };
  // Where this game's LOSER goes (used for the 3rd-place game).
  loserFeeds?: { round: number; slot: number; position: "a" | "b" };
};

function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const rng = seededRandom(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Group stage where every team plays exactly 2 games: a single cycle through
// all teams (i vs i+1, wrapping). N teams -> N games, degree 2 each.
export function generateGroupStage(teamIds: string[]): GameSpec[] {
  const n = teamIds.length;
  const games: GameSpec[] = [];
  for (let i = 0; i < n; i++) {
    games.push({
      stage: "group",
      round: 0,
      slot: i,
      teamA: teamIds[i],
      teamB: teamIds[(i + 1) % n],
      label: "Group Game (to 11)",
    });
  }
  return games;
}

// A 4-team knockout. `orderedFour` should already be in the desired pairing
// order: pairs are (0 vs 1) and (2 vs 3).
export function generateKnockout4(orderedFour: string[]): GameSpec[] {
  const [a, b, c, d] = orderedFour;
  return [
    {
      stage: "bracket",
      round: 1,
      slot: 0,
      teamA: a,
      teamB: b,
      label: "Semifinal 1",
      winnerFeeds: { round: 2, slot: 0, position: "a" },
      loserFeeds: { round: 2, slot: 1, position: "a" },
    },
    {
      stage: "bracket",
      round: 1,
      slot: 1,
      teamA: c,
      teamB: d,
      label: "Semifinal 2",
      winnerFeeds: { round: 2, slot: 0, position: "b" },
      loserFeeds: { round: 2, slot: 1, position: "b" },
    },
    {
      stage: "bracket",
      round: 2,
      slot: 0,
      teamA: null,
      teamB: null,
      label: "Final",
    },
    {
      stage: "bracket",
      round: 2,
      slot: 1,
      teamA: null,
      teamB: null,
      label: "3rd Place",
    },
  ];
}

// Seed a 4-team bracket so #1 plays #4 and #2 plays #3.
export function seedKnockout4(seededTeamIds: string[]): GameSpec[] {
  const [s1, s2, s3, s4] = seededTeamIds;
  return generateKnockout4([s1, s4, s2, s3]);
}

// Random 4-team bracket (used for top-4 out of a group stage).
export function randomKnockout4(teamIds: string[], seed: number): GameSpec[] {
  return generateKnockout4(shuffle(teamIds, seed));
}

// Round robin (used when there are exactly 3 teams).
export function generateRoundRobin(teamIds: string[]): GameSpec[] {
  const games: GameSpec[] = [];
  let slot = 0;
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      games.push({
        stage: "group",
        round: 0,
        slot: slot++,
        teamA: teamIds[i],
        teamB: teamIds[j],
        label: "Round Robin",
      });
    }
  }
  return games;
}

// Standings from finished group games.
export type Standing = {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
};

export function computeStandings(
  teamIds: string[],
  games: {
    team_a: string | null;
    team_b: string | null;
    score_a: number | null;
    score_b: number | null;
  }[],
): Standing[] {
  const table = new Map<string, Standing>();
  for (const id of teamIds) {
    table.set(id, {
      teamId: id,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0,
    });
  }
  for (const g of games) {
    if (
      g.team_a == null ||
      g.team_b == null ||
      g.score_a == null ||
      g.score_b == null
    )
      continue;
    const a = table.get(g.team_a);
    const b = table.get(g.team_b);
    if (!a || !b) continue;
    a.pointsFor += g.score_a;
    a.pointsAgainst += g.score_b;
    b.pointsFor += g.score_b;
    b.pointsAgainst += g.score_a;
    if (g.score_a > g.score_b) {
      a.wins++;
      b.losses++;
    } else if (g.score_b > g.score_a) {
      b.wins++;
      a.losses++;
    }
  }
  const standings = [...table.values()];
  for (const s of standings) s.diff = s.pointsFor - s.pointsAgainst;
  standings.sort(
    (x, y) =>
      y.wins - x.wins || y.diff - x.diff || y.pointsFor - x.pointsFor,
  );
  return standings;
}

// Decide the schedule when teams are first generated.
export function planInitialSchedule(
  teamIdsByStrength: string[],
  seed: number,
): { kind: "knockout" | "group" | "roundrobin" | "final"; games: GameSpec[] } {
  const n = teamIdsByStrength.length;
  if (n === 4) return { kind: "knockout", games: seedKnockout4(teamIdsByStrength) };
  if (n === 2) {
    return {
      kind: "final",
      games: [
        {
          stage: "bracket",
          round: 2,
          slot: 0,
          teamA: teamIdsByStrength[0],
          teamB: teamIdsByStrength[1],
          label: "Final",
        },
      ],
    };
  }
  if (n === 3)
    return { kind: "roundrobin", games: generateRoundRobin(teamIdsByStrength) };
  // n > 4 -> group stage first; bracket generated later from the top 4.
  return { kind: "group", games: generateGroupStage(shuffle(teamIdsByStrength, seed)) };
}
