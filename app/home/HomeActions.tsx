"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";
import {
  RATING_MODE_LABELS,
  TEAM_SIZES,
  VISIBILITY_LABELS,
  type RatingMode,
  type StatsVisibility,
  type TeamSize,
} from "@/lib/constants";
import { createTournament, joinTournament } from "@/app/actions/tournament";

export function HomeActions() {
  const [mode, setMode] = useState<"none" | "create" | "join">("none");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="lg"
          onClick={() => setMode(mode === "create" ? "none" : "create")}
        >
          + New tournament
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => setMode(mode === "join" ? "none" : "join")}
        >
          Join by code
        </Button>
      </div>
      {mode === "create" && <CreateForm />}
      {mode === "join" && <JoinForm />}
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ratingMode, setRatingMode] = useState<RatingMode>("eight");
  const [visibility, setVisibility] = useState<StatsVisibility>("creator_only");
  const [teamSize, setTeamSize] = useState<TeamSize>(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    const res = await createTournament({
      name,
      rating_mode: ratingMode,
      stats_visibility: visibility,
      team_size: teamSize,
    });
    if (res.ok) {
      const id = (res.data as { id: string }).id;
      router.push(`/tournament/${id}`);
    } else {
      setError(res.error);
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4 mt-1">
      <div>
        <Label>Tournament name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Friday Night Hoops"
        />
      </div>

      <div>
        <Label>Rating style</Label>
        <div className="space-y-2">
          {(Object.keys(RATING_MODE_LABELS) as RatingMode[]).map((m) => (
            <ChoiceRow
              key={m}
              selected={ratingMode === m}
              onClick={() => setRatingMode(m)}
              label={RATING_MODE_LABELS[m]}
            />
          ))}
        </div>
      </div>

      <div>
        <Label>Who sees the stats after rating?</Label>
        <div className="space-y-2">
          {(Object.keys(VISIBILITY_LABELS) as StatsVisibility[]).map((v) => (
            <ChoiceRow
              key={v}
              selected={visibility === v}
              onClick={() => setVisibility(v)}
              label={VISIBILITY_LABELS[v]}
            />
          ))}
        </div>
      </div>

      <div>
        <Label>Players per team (you can change this later)</Label>
        <div className="flex gap-2">
          {TEAM_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setTeamSize(s)}
              className={`flex-1 rounded-xl py-3 font-semibold border transition ${
                teamSize === s
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-[var(--surface-2)] border-[var(--border)]"
              }`}
            >
              {s}v{s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
        {loading ? <Spinner /> : "Create tournament"}
      </Button>
    </Card>
  );
}

function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    const res = await joinTournament(code);
    if (res.ok) {
      const id = (res.data as { id: string }).id;
      router.push(`/tournament/${id}`);
    } else {
      setError(res.error);
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-3 mt-1">
      <Label>Enter tournament code</Label>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCDE"
        className="font-mono tracking-[0.3em] text-center text-lg uppercase"
        maxLength={6}
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
        {loading ? <Spinner /> : "Join"}
      </Button>
    </Card>
  );
}

function ChoiceRow({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl px-3 py-2.5 text-sm border transition ${
        selected
          ? "bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--foreground)]"
          : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
      }`}
    >
      {label}
    </button>
  );
}
