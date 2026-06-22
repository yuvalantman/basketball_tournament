"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { MatchupCard } from "@/components/MatchupCard";
import { computeStandings } from "@/lib/bracket";
import { setGameScore } from "@/app/actions/tournament";
import type { Game, PlayerStats, Team, Tournament } from "@/lib/types";

export function BracketTab({
  tournament,
  teams,
  games,
  isCreator,
  statsById,
}: {
  tournament: Tournament;
  teams: Team[];
  games: Game[];
  isCreator: boolean;
  statsById: Map<string, PlayerStats>;
}) {
  const stats = statsById;
  const [matchup, setMatchup] = useState<{ a: Team; b: Team; label: string } | null>(
    null,
  );

  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );

  const groupGames = games.filter((g) => g.stage === "group");
  const bracketGames = games.filter((g) => g.stage === "bracket");

  const standings = useMemo(
    () => computeStandings(teams.map((t) => t.id), groupGames),
    [teams, groupGames],
  );

  const final = bracketGames.find((g) => g.round === 2 && g.slot === 0);
  const champion =
    final?.winner_team_id != null ? teamById.get(final.winner_team_id) : null;

  return (
    <div className="space-y-5">
      {champion && (
        <Card className="text-center bg-gradient-to-b from-[var(--primary)]/20 to-transparent border-[var(--primary)]/40">
          <div className="text-4xl mb-1">🏆</div>
          <div className="text-xs text-[var(--muted)] uppercase tracking-widest">
            Champions
          </div>
          <div className="text-2xl font-black">{champion.name}</div>
          <div className="flex justify-center gap-1 mt-2">
            {(champion.members ?? []).map((m) => (
              <Avatar key={m.id} src={m.photo_url} name={m.display_name} size={32} />
            ))}
          </div>
        </Card>
      )}

      {groupGames.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
            Group Stage — first to 11
          </h3>
          <StandingsTable standings={standings} teamById={teamById} />
          {groupGames.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              teamById={teamById}
              isCreator={isCreator}
              tournamentId={tournament.id}
              onIntro={(a, b, label) => setMatchup({ a, b, label })}
            />
          ))}
        </section>
      )}

      {bracketGames.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
            Bracket
          </h3>
          {[1, 2].map((round) => {
            const rg = bracketGames.filter((g) => g.round === round);
            if (rg.length === 0) return null;
            return (
              <div key={round} className="space-y-3">
                {rg.map((g) => (
                  <GameRow
                    key={g.id}
                    game={g}
                    teamById={teamById}
                    isCreator={isCreator}
                    tournamentId={tournament.id}
                    onIntro={(a, b, label) => setMatchup({ a, b, label })}
                  />
                ))}
              </div>
            );
          })}
        </section>
      )}

      {games.length === 0 && (
        <Card className="text-center text-[var(--muted)] py-8">
          No games scheduled yet.
        </Card>
      )}

      <MatchupCard
        open={matchup != null}
        onClose={() => setMatchup(null)}
        teamA={matchup?.a ?? null}
        teamB={matchup?.b ?? null}
        stats={stats}
        label={matchup?.label}
      />
    </div>
  );
}

function StandingsTable({
  standings,
  teamById,
}: {
  standings: ReturnType<typeof computeStandings>;
  teamById: Map<string, Team>;
}) {
  return (
    <Card className="p-3">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 text-sm">
        <div className="text-xs text-[var(--muted)]">Team</div>
        <div className="text-xs text-[var(--muted)] text-center">W-L</div>
        <div className="text-xs text-[var(--muted)] text-center">+/-</div>
        {standings.map((s, i) => (
          <div key={s.teamId} className="contents">
            <div className="truncate">
              {i < 4 && <span className="text-[var(--primary)] mr-1">{i + 1}</span>}
              {teamById.get(s.teamId)?.name ?? "?"}
            </div>
            <div className="text-center font-mono">
              {s.wins}-{s.losses}
            </div>
            <div className="text-center font-mono text-[var(--muted)]">
              {s.diff > 0 ? `+${s.diff}` : s.diff}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GameRow({
  game,
  teamById,
  isCreator,
  tournamentId,
  onIntro,
}: {
  game: Game;
  teamById: Map<string, Team>;
  isCreator: boolean;
  tournamentId: string;
  onIntro: (a: Team, b: Team, label: string) => void;
}) {
  const router = useRouter();
  const teamA = game.team_a ? teamById.get(game.team_a) : null;
  const teamB = game.team_b ? teamById.get(game.team_b) : null;
  const [editing, setEditing] = useState(false);
  const [sa, setSa] = useState(game.score_a?.toString() ?? "");
  const [sb, setSb] = useState(game.score_b?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scored = game.score_a != null && game.score_b != null;
  const label =
    game.stage === "bracket"
      ? game.round === 2
        ? game.slot === 1
          ? "3rd Place"
          : "Final"
        : `Semifinal ${game.slot + 1}`
      : "Group Game";

  async function save() {
    setBusy(true);
    setError(null);
    const res = await setGameScore(tournamentId, game.id, Number(sa), Number(sb));
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else setError(res.error);
    setBusy(false);
  }

  const winnerA = scored && game.winner_team_id === game.team_a;
  const winnerB = scored && game.winner_team_id === game.team_b;

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--muted)] uppercase tracking-wide">
          {label}
        </span>
        {teamA && teamB && (
          <button
            onClick={() => onIntro(teamA, teamB, label)}
            className="text-xs text-[var(--accent)] font-medium"
          >
            ▶ Intro
          </button>
        )}
      </div>

      <TeamLine team={teamA} score={game.score_a} winner={winnerA} />
      <TeamLine team={teamB} score={game.score_b} winner={winnerB} />

      {isCreator && teamA && teamB && (
        <>
          {editing ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={sa}
                  onChange={(e) => setSa(e.target.value)}
                  placeholder={teamA.name}
                  className="text-center"
                />
                <span className="text-[var(--muted)]">:</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={sb}
                  onChange={(e) => setSb(e.target.value)}
                  placeholder={teamB.name}
                  className="text-center"
                />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={busy || !sa || !sb}>
                  {busy ? <Spinner /> : "Save score"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
              className="w-full"
            >
              {scored ? "Edit score" : "Enter score"}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function TeamLine({
  team,
  score,
  winner,
}: {
  team: Team | null | undefined;
  score: number | null;
  winner: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        winner ? "bg-[var(--primary)]/15" : ""
      }`}
    >
      <div className="flex -space-x-2">
        {(team?.members ?? []).slice(0, 3).map((m) => (
          <Avatar
            key={m.id}
            src={m.photo_url}
            name={m.display_name}
            size={26}
            className="ring-2 ring-[var(--surface)]"
          />
        ))}
      </div>
      <span className={`flex-1 truncate ${winner ? "font-bold" : ""}`}>
        {team?.name ?? <span className="text-[var(--muted)]">TBD</span>}
      </span>
      {winner && <Badge className="text-[10px]">W</Badge>}
      <span className="font-mono font-bold w-6 text-right">
        {score ?? "–"}
      </span>
    </div>
  );
}
