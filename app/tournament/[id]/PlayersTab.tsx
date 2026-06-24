"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import {
  TEAM_SIZES,
  VISIBILITY_LABELS,
  cmToFeet,
  type StatsVisibility,
  type TeamSize,
} from "@/lib/constants";
import type { Profile, Restriction, Tournament } from "@/lib/types";
import {
  addRestriction,
  removePlayer,
  removeRestriction,
  updateSettings,
} from "@/app/actions/tournament";

export function PlayersTab({
  tournament,
  isCreator,
  roster,
  restrictions,
}: {
  tournament: Tournament;
  isCreator: boolean;
  roster: Profile[];
  restrictions: Restriction[];
}) {
  const router = useRouter();
  const nameOf = (id: string) =>
    roster.find((p) => p.id === id)?.display_name ?? "Player";

  // Settings & restrictions are editable while organizing (before games).
  const organizing =
    tournament.status === "lobby" ||
    tournament.status === "rating" ||
    tournament.status === "teams";
  // Removing a player is allowed any time the tournament is still running —
  // including mid-bracket. Removing frees their team slot; a replacement can
  // join by code and be assigned to that team (no rebuild needed).
  const canManageRoster = isCreator && tournament.status !== "done";

  async function remove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the tournament?`)) return;
    await removePlayer(tournament.id, userId);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <ShareCode code={tournament.code} />

      {isCreator && organizing && <SettingsCard tournament={tournament} />}

      <div>
        <h3 className="text-sm font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide">
          {roster.length} player{roster.length !== 1 ? "s" : ""}
        </h3>
        <div className="space-y-2">
          {roster.map((p) => (
            <Card key={p.id} className="flex items-center gap-3 py-3">
              <Avatar src={p.photo_url} name={p.display_name} size={44} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.display_name}</div>
                <div className="text-xs text-[var(--muted)]">@{p.username}</div>
              </div>
              <div className="text-right text-xs text-[var(--muted)]">
                {p.height_cm ? <div>{cmToFeet(p.height_cm)}</div> : null}
                {!p.photo_url && <Badge className="mt-1">no photo</Badge>}
              </div>
              {canManageRoster && p.id !== tournament.creator_id && (
                <button
                  onClick={() => remove(p.id, p.display_name)}
                  className="text-[var(--muted)] hover:text-red-400 px-1"
                  title="Remove player"
                >
                  ✕
                </button>
              )}
            </Card>
          ))}
        </div>
        {canManageRoster && (
          <p className="text-xs text-[var(--muted)] mt-2">
            New players can join with the code anytime — even now. After they
            rate (and are rated), slot them into a team from the{" "}
            <span className="font-medium">Teams</span> tab. No need to rebuild.
          </p>
        )}
      </div>

      {isCreator && organizing && (
        <RestrictionsEditor
          tournamentId={tournament.id}
          roster={roster}
          restrictions={restrictions}
          nameOf={nameOf}
        />
      )}
    </div>
  );
}

function SettingsCard({ tournament }: { tournament: Tournament }) {
  const router = useRouter();
  const [name, setName] = useState(tournament.name);
  const [teamSize, setTeamSize] = useState<TeamSize>(
    tournament.team_size as TeamSize,
  );
  const [visibility, setVisibility] = useState<StatsVisibility>(
    tournament.stats_visibility,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== tournament.name ||
    teamSize !== tournament.team_size ||
    visibility !== tournament.stats_visibility;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await updateSettings(tournament.id, {
      name,
      team_size: teamSize,
      stats_visibility: visibility,
    });
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else setError(res.error);
    setBusy(false);
  }

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Tournament settings</h3>

      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <Label>Players per team</Label>
        <div className="flex gap-2">
          {TEAM_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setTeamSize(s)}
              className={`flex-1 rounded-xl py-2.5 font-semibold border transition ${
                teamSize === s
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-[var(--surface-2)] border-[var(--border)]"
              }`}
            >
              {s}v{s}
            </button>
          ))}
        </div>
        {tournament.status === "teams" && teamSize !== tournament.team_size && (
          <p className="text-xs text-amber-400 mt-1.5">
            Re-roll the teams after saving to apply the new size.
          </p>
        )}
      </div>

      <div>
        <Label>Stats visibility</Label>
        <div className="space-y-2">
          {(Object.keys(VISIBILITY_LABELS) as StatsVisibility[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`w-full text-left rounded-xl px-3 py-2 text-sm border transition ${
                visibility === v
                  ? "bg-[var(--primary)]/15 border-[var(--primary)]"
                  : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {VISIBILITY_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {saved && !dirty && <p className="text-green-400 text-sm">Saved!</p>}
      <Button className="w-full" onClick={save} disabled={busy || !dirty}>
        {busy ? <Spinner /> : "Save settings"}
      </Button>
    </Card>
  );
}

function ShareCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <Card className="flex items-center justify-between bg-[var(--surface-2)]">
      <div>
        <div className="text-xs text-[var(--muted)]">Invite code</div>
        <div className="text-2xl font-mono tracking-[0.3em] font-bold">{code}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={copy}>
        {copied ? "Copied!" : "Copy"}
      </Button>
    </Card>
  );
}

function RestrictionsEditor({
  tournamentId,
  roster,
  restrictions,
  nameOf,
}: {
  tournamentId: string;
  roster: Profile[];
  restrictions: Restriction[];
  nameOf: (id: string) => string;
}) {
  const router = useRouter();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!a || !b || a === b) {
      setError("Pick two different players.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addRestriction(tournamentId, a, b);
    if (!res.ok) setError(res.error);
    else {
      setA("");
      setB("");
      router.refresh();
    }
    setBusy(false);
  }

  async function remove(id: string) {
    await removeRestriction(tournamentId, id);
    router.refresh();
  }

  return (
    <Card className="space-y-3">
      <div>
        <h3 className="font-semibold">Keep apart</h3>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          These pairs will never end up on the same team.
        </p>
      </div>

      <div className="flex gap-2">
        <select
          value={a}
          onChange={(e) => setA(e.target.value)}
          className="flex-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2.5 text-sm"
        >
          <option value="">Player A</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <select
          value={b}
          onChange={(e) => setB(e.target.value)}
          className="flex-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2.5 text-sm"
        >
          <option value="">Player B</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={add} disabled={busy}>
          Add
        </Button>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {restrictions.length > 0 && (
        <div className="space-y-2 pt-1">
          {restrictions.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between text-sm bg-[var(--surface-2)] rounded-lg px-3 py-2"
            >
              <span>
                {nameOf(r.player_a)} <span className="text-[var(--muted)]">⊗</span>{" "}
                {nameOf(r.player_b)}
              </span>
              <button
                onClick={() => remove(r.id)}
                className="text-[var(--muted)] hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
