"use client";

import { useState } from "react";
import { Button, Input, Spinner } from "@/components/ui";
import { renameTeam } from "@/app/actions/gameday";
import type { Team } from "@/lib/types";

// Inline team-name editor. A team member (or the gameday's manager) can
// rename their team any time. Read-only otherwise.
export function TeamNameEditor({
  gamedayId,
  team,
  canEdit,
  onDone,
  className = "font-bold text-lg",
}: {
  gamedayId: string;
  team: Team;
  canEdit: boolean;
  onDone: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const clean = name.trim();
    if (!clean || clean === team.name) {
      setEditing(false);
      setName(team.name);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await renameTeam(gamedayId, team.id, clean);
    if (res.ok) {
      setEditing(false);
      onDone();
    } else {
      setError(res.error);
    }
    setBusy(false);
  }

  if (!canEdit) return <h3 className={className}>{team.name}</h3>;

  if (!editing)
    return (
      <button
        onClick={() => {
          setName(team.name);
          setEditing(true);
        }}
        className={`${className} flex items-center gap-1.5 text-left`}
        title="Rename your team"
      >
        {team.name}
        <span className="text-[var(--muted)] text-sm">✎</span>
      </button>
    );

  return (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          maxLength={30}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setEditing(false);
              setName(team.name);
            }
          }}
          className="py-2"
        />
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
