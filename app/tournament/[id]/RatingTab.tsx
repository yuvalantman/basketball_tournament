"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Badge, Button, Card, Spinner } from "@/components/ui";
import { PARAM_LABELS, RATING_PARAMS, type RatingParam } from "@/lib/constants";
import type { Profile, Tournament } from "@/lib/types";

export function RatingTab({
  tournament,
  roster,
  myUserId,
  ratedIds,
}: {
  tournament: Tournament;
  roster: Profile[];
  myUserId: string;
  ratedIds: string[];
}) {
  const others = roster.filter((p) => p.id !== myUserId);
  const [rated, setRated] = useState<Set<string>>(new Set(ratedIds));
  const [openId, setOpenId] = useState<string | null>(null);

  const done = rated.size;
  const total = others.length;

  return (
    <div className="space-y-4">
      <Card className="bg-[var(--surface-2)]">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">Your ratings</span>
          <span className="text-sm text-[var(--muted)]">
            {done}/{total} done
          </span>
        </div>
        <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full bg-[var(--primary)] transition-all"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <p className="text-xs text-[var(--muted)] mt-2">
          Ratings are anonymous — no one can see who you rated or how.
        </p>
      </Card>

      <div className="space-y-2">
        {others.map((p) => (
          <RatePlayerCard
            key={p.id}
            tournament={tournament}
            rater={myUserId}
            player={p}
            isRated={rated.has(p.id)}
            isOpen={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            onSaved={() => {
              setRated((s) => new Set(s).add(p.id));
              setOpenId(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function RatePlayerCard({
  tournament,
  rater,
  player,
  isRated,
  isOpen,
  onToggle,
  onSaved,
}: {
  tournament: Tournament;
  rater: string;
  player: Profile;
  isRated: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const isSingle = tournament.rating_mode === "single";
  const [scores, setScores] = useState<Record<string, number>>({});
  const [single, setSingle] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = isSingle
    ? single > 0
    : RATING_PARAMS.every((p) => (scores[p] ?? 0) > 0);

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const row: Record<string, unknown> = {
      tournament_id: tournament.id,
      rater_id: rater,
      ratee_id: player.id,
    };
    if (isSingle) row.single_score = single;
    else for (const p of RATING_PARAMS) row[p] = scores[p];

    const { error } = await supabase
      .from("ratings")
      .upsert(row, { onConflict: "tournament_id,rater_id,ratee_id" });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
    router.refresh();
  }

  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        <Avatar src={player.photo_url} name={player.display_name} size={44} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{player.display_name}</div>
          <div className="text-xs text-[var(--muted)]">
            {isRated ? "Tap to edit your rating" : "Tap to rate"}
          </div>
        </div>
        {isRated ? (
          <Badge className="bg-green-500/15 border-green-500/40 text-green-400">
            ✓ Rated
          </Badge>
        ) : (
          <span className="text-[var(--muted)]">{isOpen ? "▲" : "▼"}</span>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--border)] p-4 space-y-3">
          {isSingle ? (
            <div>
              <div className="text-sm font-medium mb-2">Overall (1–10)</div>
              <DotRow
                max={10}
                value={single}
                onChange={setSingle}
              />
            </div>
          ) : (
            RATING_PARAMS.map((param: RatingParam) => (
              <div key={param} className="flex items-center justify-between gap-3">
                <span className="text-sm w-24 shrink-0">{PARAM_LABELS[param]}</span>
                <DotRow
                  max={5}
                  value={scores[param] ?? 0}
                  onChange={(v) => setScores((s) => ({ ...s, [param]: v }))}
                />
              </div>
            ))
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button
            className="w-full"
            onClick={save}
            disabled={!ready || saving}
          >
            {saving ? <Spinner /> : isRated ? "Update rating" : "Save rating"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function DotRow({
  max,
  value,
  onChange,
}: {
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap justify-end">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`h-8 w-8 rounded-lg text-sm font-semibold border transition ${
            n <= value
              ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
              : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
