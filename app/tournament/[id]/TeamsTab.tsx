"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Spinner } from "@/components/ui";
import { cmToFeet } from "@/lib/constants";
import type { Profile, Team, Tournament } from "@/lib/types";
import { generateTeams, swapPlayers } from "@/app/actions/tournament";

function avgHeight(members: Profile[] = []): number | null {
  const hs = members.map((m) => m.height_cm).filter((h): h is number => !!h);
  if (!hs.length) return null;
  return hs.reduce((a, b) => a + b, 0) / hs.length;
}

export function TeamsTab({
  tournament,
  teams,
  isCreator,
}: {
  tournament: Tournament;
  teams: Team[];
  isCreator: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [swapMode, setSwapMode] = useState(false);

  async function reroll() {
    setBusy(true);
    setMsg(null);
    const res = await generateTeams(tournament.id, Math.floor(Math.random() * 1e9));
    if (res.ok) {
      const data = res.data as { restrictionViolations: number };
      setMsg(
        data.restrictionViolations > 0
          ? "Teams re-rolled — but some 'keep apart' pairs couldn't be separated."
          : "Teams re-rolled!",
      );
      router.refresh();
    } else setMsg(res.error);
    setBusy(false);
  }

  if (teams.length === 0)
    return (
      <Card className="text-center text-[var(--muted)] py-8">
        Teams haven&apos;t been generated yet.
      </Card>
    );

  return (
    <div className="space-y-4">
      {isCreator && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={reroll} disabled={busy}>
            {busy ? <Spinner /> : "🎲 Re-roll teams"}
          </Button>
          <Button
            variant={swapMode ? "primary" : "secondary"}
            size="sm"
            onClick={() => setSwapMode((s) => !s)}
          >
            {swapMode ? "Done swapping" : "Swap players"}
          </Button>
        </div>
      )}
      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}

      {swapMode && isCreator ? (
        <SwapUI tournamentId={tournament.id} teams={teams} onDone={() => router.refresh()} />
      ) : (
        teams.map((t) => {
          const ah = avgHeight(t.members);
          return (
            <Card key={t.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{t.name}</h3>
                {ah && (
                  <Badge>avg {cmToFeet(Math.round(ah))}</Badge>
                )}
              </div>
              <div className="space-y-1.5">
                {(t.members ?? []).map((m) => (
                  <div key={m.id} className="flex items-center gap-3">
                    <Avatar src={m.photo_url} name={m.display_name} size={36} />
                    <span className="flex-1 truncate">{m.display_name}</span>
                    {m.height_cm && (
                      <span className="text-xs text-[var(--muted)]">
                        {cmToFeet(m.height_cm)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

function SwapUI({
  tournamentId,
  teams,
  onDone,
}: {
  tournamentId: string;
  teams: Team[];
  onDone: () => void;
}) {
  const [sel, setSel] = useState<{ teamId: string; userId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(teamId: string, userId: string) {
    if (!sel) {
      setSel({ teamId, userId });
      return;
    }
    if (sel.userId === userId) {
      setSel(null);
      return;
    }
    if (sel.teamId === teamId) {
      // same team — just change selection
      setSel({ teamId, userId });
      return;
    }
    setBusy(true);
    await swapPlayers(tournamentId, sel.userId, sel.teamId, userId, teamId);
    setSel(null);
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        Tap one player, then a player on another team to swap them.
        {busy && " …swapping"}
      </p>
      {teams.map((t) => (
        <Card key={t.id} className="space-y-2">
          <h3 className="font-bold">{t.name}</h3>
          <div className="space-y-1.5">
            {(t.members ?? []).map((m) => {
              const selected = sel?.userId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => pick(t.id, m.id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 border transition ${
                    selected
                      ? "border-[var(--primary)] bg-[var(--primary)]/15"
                      : "border-transparent"
                  }`}
                >
                  <Avatar src={m.photo_url} name={m.display_name} size={32} />
                  <span className="flex-1 text-left truncate">{m.display_name}</span>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
