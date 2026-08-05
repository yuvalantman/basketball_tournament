"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { DISPLAY_PRESETS, formatHeight, type DisplayOptions } from "@/lib/constants";
import type { Group, Profile } from "@/lib/types";
import { removeMember, updateGroupSettings } from "@/app/actions/group";

const DISPLAY_LABELS: { key: keyof DisplayOptions; label: string }[] = [
  { key: "overall", label: "Overall score" },
  { key: "averages", label: "Per-attribute averages" },
  { key: "radar", label: "Radar chart" },
  { key: "best_worst", label: "Best / worst skill" },
  { key: "archetype", label: "Archetype" },
];

export function PlayersTab({
  group,
  isManager,
  roster,
}: {
  group: Group;
  isManager: boolean;
  roster: Profile[];
}) {
  const router = useRouter();

  async function remove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the group?`)) return;
    await removeMember(group.id, userId);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <ShareCode code={group.code} />

      {isManager && <SettingsCard group={group} />}

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
                {p.height_cm ? <div>{formatHeight(p.height_cm)}</div> : null}
                {!p.photo_url && <Badge className="mt-1">no photo</Badge>}
              </div>
              {isManager && p.id !== group.creator_id && (
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
        <p className="text-xs text-[var(--muted)] mt-2">
          New players can join with the code anytime — rating never closes, so latecomers can
          be rated whenever people get to it.
        </p>
      </div>
    </div>
  );
}

function SettingsCard({ group }: { group: Group }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [options, setOptions] = useState<DisplayOptions>(group.display_options);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== group.name || JSON.stringify(options) !== JSON.stringify(group.display_options);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await updateGroupSettings(group.id, { name, display_options: options });
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else setError(res.error);
    setBusy(false);
  }

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Group settings</h3>

      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <Label>What members can see on player cards</Label>
        <div className="flex gap-2 mb-3">
          <Button size="sm" variant="secondary" onClick={() => setOptions(DISPLAY_PRESETS.nothing)}>
            Nothing
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOptions(DISPLAY_PRESETS.overallOnly)}>
            Overall only
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOptions(DISPLAY_PRESETS.full)}>
            Full breakdown
          </Button>
        </div>
        <div className="space-y-2">
          {DISPLAY_LABELS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm border border-[var(--border)] bg-[var(--surface-2)]"
            >
              {label}
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                className="h-4 w-4"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)] mt-2">
          Numbers are always shown on a 70–100 scale. Archetype only applies to sports that
          support it.
        </p>
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
