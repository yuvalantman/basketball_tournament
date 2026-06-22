"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Spinner } from "@/components/ui";
import {
  advanceGroupToBracket,
  generateTeams,
  getRatingProgress,
  setStatus,
  startSchedule,
} from "@/app/actions/tournament";
import type { Game, Profile, Team, Tournament } from "@/lib/types";

type Progress = {
  user_id: string;
  display_name: string;
  rated: number;
  ratedBy: number;
  expected: number;
  completed: boolean;
  fullyRated: boolean;
};

export function CreatorBar({
  tournament,
  roster,
  teams,
  games,
}: {
  tournament: Tournament;
  roster: Profile[];
  teams: Team[];
  games: Game[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress[] | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  const status = tournament.status;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.error ?? "Something went wrong");
    else router.refresh();
    setBusy(false);
  }

  async function loadProgress() {
    setShowProgress((s) => !s);
    if (!progress) {
      const res = await getRatingProgress(tournament.id);
      if (res.ok) setProgress((res.data as { progress: Progress[] }).progress);
    }
  }

  const groupGames = games.filter((g) => g.stage === "group");
  const bracketGames = games.filter((g) => g.stage === "bracket");
  const groupDone =
    groupGames.length > 0 &&
    groupGames.every((g) => g.score_a != null && g.score_b != null);
  const needsBracket = groupDone && bracketGames.length === 0;
  const final = bracketGames.find((g) => g.round === 2 && g.slot === 0);
  const finalDone = final?.winner_team_id != null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur px-4 py-3">
      <div className="max-w-md mx-auto space-y-2">
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {status === "rating" && showProgress && progress && (
          <Card className="max-h-56 overflow-y-auto space-y-1.5 mb-1">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[11px] text-[var(--muted)] uppercase tracking-wide pb-1">
              <span>Player</span>
              <span className="text-center w-14">Rated</span>
              <span className="text-center w-14">Rated by</span>
            </div>
            {progress.map((p) => (
              <div
                key={p.user_id}
                className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center text-sm"
              >
                <span className="truncate">{p.display_name}</span>
                <span
                  className={`text-center w-14 ${p.completed ? "text-green-400" : "text-[var(--muted)]"}`}
                >
                  {p.completed ? "✓" : `${p.rated}/${p.expected}`}
                </span>
                <span
                  className={`text-center w-14 ${p.fullyRated ? "text-green-400" : "text-amber-400"}`}
                >
                  {p.fullyRated ? "✓" : `${p.ratedBy}/${p.expected}`}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-[var(--muted)] pt-1">
              &quot;Rated&quot; = how many they&apos;ve scored. &quot;Rated by&quot; =
              how many have scored them. Both should hit {progress[0]?.expected ?? 0}.
            </p>
          </Card>
        )}

        {status === "lobby" && (
          <>
            <p className="text-xs text-[var(--muted)] text-center">
              {roster.length} player{roster.length !== 1 ? "s" : ""} joined
              {roster.length < 8
                ? " · 8+ recommended so everyone gets 7 ratings"
                : ""}
            </p>
            <Button
              className="w-full"
              size="lg"
              disabled={busy || roster.length < 2}
              onClick={() => run(() => setStatus(tournament.id, "rating"))}
            >
              {busy ? <Spinner /> : "Start rating →"}
            </Button>
          </>
        )}

        {status === "rating" && (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={loadProgress}>
              {showProgress ? "Hide" : "Who's done?"}
            </Button>
            <Button
              className="flex-1"
              size="lg"
              disabled={busy}
              onClick={() => run(() => generateTeams(tournament.id))}
            >
              {busy ? <Spinner /> : "Close & build teams →"}
            </Button>
          </div>
        )}

        {status === "teams" && (
          <Button
            className="w-full"
            size="lg"
            disabled={busy || teams.length < 2}
            onClick={() => run(() => startSchedule(tournament.id))}
          >
            {busy ? <Spinner /> : "Lock teams & start games →"}
          </Button>
        )}

        {status === "bracket" && needsBracket && (
          <Button
            className="w-full"
            size="lg"
            disabled={busy}
            onClick={() => run(() => advanceGroupToBracket(tournament.id))}
          >
            {busy ? <Spinner /> : "Lock top 4 → bracket"}
          </Button>
        )}

        {status === "bracket" && finalDone && (
          <Button
            className="w-full"
            size="lg"
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => setStatus(tournament.id, "done"))}
          >
            {busy ? <Spinner /> : "🏆 Finish tournament"}
          </Button>
        )}
      </div>
    </div>
  );
}
