"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { HelpTooltip } from "@/components/HelpTooltip";
import { DISPLAY_PRESETS, formatHeight, type DisplayOptions } from "@/lib/constants";
import type { Group, Profile } from "@/lib/types";
import type { GroupPlayerMeta } from "@/lib/data";
import {
  leaveGroup,
  removeMember,
  setMemberManagerStatus,
  setMemberRatingWeight,
  updateGroupSettings,
} from "@/app/actions/group";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { pluralKey, type TranslationKey } from "@/lib/i18n";

const DISPLAY_KEYS: { key: keyof DisplayOptions; tKey: TranslationKey }[] = [
  { key: "overall", tKey: "players.displayOverall" },
  { key: "averages", tKey: "players.displayAverages" },
  { key: "radar", tKey: "players.displayRadar" },
  { key: "best_worst", tKey: "players.displayBestWorst" },
  { key: "archetype", tKey: "players.displayArchetype" },
];

export function PlayersTab({
  group,
  isManager,
  myUserId,
  roster,
  playerMeta,
}: {
  group: Group;
  isManager: boolean;
  myUserId: string;
  roster: Profile[];
  playerMeta: Record<string, GroupPlayerMeta>;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(userId: string, name: string) {
    if (!confirm(t("players.removeConfirm", { name }))) return;
    await removeMember(group.id, userId);
    router.refresh();
  }

  async function toggleManager(userId: string, makeManager: boolean) {
    setBusyId(userId);
    await setMemberManagerStatus(group.id, userId, makeManager);
    router.refresh();
    setBusyId(null);
  }

  const isCreator = myUserId === group.creator_id;

  async function leave() {
    if (!confirm(t("players.leaveConfirm", { name: group.name }))) return;
    const res = await leaveGroup(group.id);
    if (res.ok) router.push("/home");
  }

  return (
    <div className="space-y-5">
      <ShareCode code={group.code} />

      {isManager && <SettingsCard group={group} />}
      {isManager && (
        <RatingWeightCard group={group} roster={roster} playerMeta={playerMeta} />
      )}

      <div>
        <h3 className="text-sm font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide">
          {roster.length} {t(pluralKey(roster.length, "players.playersCount"))}
        </h3>
        <div className="space-y-2">
          {roster.map((p) => {
            const isPlayerCreator = p.id === group.creator_id;
            const isPlayerManager = playerMeta[p.id]?.isManager ?? false;
            const weight = playerMeta[p.id]?.ratingWeight ?? 1;
            return (
              <Card key={p.id} className="py-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Avatar src={p.photo_url} name={p.display_name} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.display_name}</div>
                    <div className="text-xs text-[var(--muted)]">@{p.username}</div>
                  </div>
                  <div className="text-end text-xs text-[var(--muted)]">
                    {p.height_cm ? <div>{formatHeight(p.height_cm)}</div> : null}
                    {!p.photo_url && <Badge className="mt-1">{t("players.noPhoto")}</Badge>}
                  </div>
                  {isPlayerCreator && <Badge>{t("players.creatorBadge")}</Badge>}
                  {!isPlayerCreator && isPlayerManager && <Badge>{t("players.managerBadge")}</Badge>}
                  {weight > 1 && (
                    <Badge className="bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]">
                      {t("players.ratingPowerBadge", { n: weight })}
                    </Badge>
                  )}
                  {isManager && !isPlayerCreator && (
                    <button
                      onClick={() => remove(p.id, p.display_name)}
                      className="text-[var(--muted)] hover:text-red-400 px-1"
                      title={t("players.removePlayerTitle")}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {isManager && !isPlayerCreator && (
                  <div className="ps-[56px]">
                    <button
                      onClick={() => toggleManager(p.id, !isPlayerManager)}
                      disabled={busyId === p.id}
                      className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
                    >
                      {isPlayerManager ? t("players.removeManager") : t("players.makeManager")}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-[var(--muted)] mt-2">{t("players.joinAnytimeHint")}</p>
      </div>

      {!isCreator && (
        <Button variant="secondary" className="w-full" onClick={leave}>
          {t("players.leaveGroup")}
        </Button>
      )}
    </div>
  );
}

function RatingWeightCard({
  group,
  roster,
  playerMeta,
}: {
  group: Group;
  roster: Profile[];
  playerMeta: Record<string, GroupPlayerMeta>;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const others = roster.filter((p) => p.id !== group.creator_id);

  async function setWeight(userId: string, weight: 1 | 2 | 3) {
    setBusyId(userId);
    await setMemberRatingWeight(group.id, userId, weight);
    router.refresh();
    setBusyId(null);
  }

  if (others.length === 0) return null;

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold flex items-center gap-1.5">
        {t("players.ratingPower")}
        <HelpTooltip text={t("help.ratingPower")} />
      </h3>
      <div className="space-y-2">
        {others.map((p) => {
          const weight = playerMeta[p.id]?.ratingWeight ?? 1;
          return (
            <div key={p.id} className="flex items-center gap-3">
              <Avatar src={p.photo_url} name={p.display_name} size={32} />
              <span className="flex-1 truncate text-sm">{p.display_name}</span>
              <div className="flex gap-1">
                {([1, 2, 3] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setWeight(p.id, w)}
                    disabled={busyId === p.id}
                    className={`h-7 w-9 rounded-md text-xs font-semibold border transition disabled:opacity-50 ${
                      weight === w
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    {w}×
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SettingsCard({ group }: { group: Group }) {
  const router = useRouter();
  const { t } = useLocale();
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
      <h3 className="font-semibold">{t("players.groupSettings")}</h3>

      <div>
        <Label>{t("players.name")}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <Label>{t("players.whatMembersCanSee")}</Label>
        <div className="flex gap-2 mb-3">
          <Button size="sm" variant="secondary" onClick={() => setOptions(DISPLAY_PRESETS.nothing)}>
            {t("players.presetNothing")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOptions(DISPLAY_PRESETS.overallOnly)}>
            {t("players.presetOverallOnly")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOptions(DISPLAY_PRESETS.full)}>
            {t("players.presetFull")}
          </Button>
        </div>
        <div className="space-y-2">
          {DISPLAY_KEYS.map(({ key, tKey }) => (
            <label
              key={key}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm border border-[var(--border)] bg-[var(--surface-2)]"
            >
              {t(tKey)}
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                className="h-4 w-4"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)] mt-2">{t("players.scaleNote")}</p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {saved && !dirty && <p className="text-green-400 text-sm">{t("common.saved")}</p>}
      <Button className="w-full" onClick={save} disabled={busy || !dirty}>
        {busy ? <Spinner /> : t("players.saveSettings")}
      </Button>
    </Card>
  );
}

function ShareCode({ code }: { code: string }) {
  const { t } = useLocale();
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
        <div className="text-xs text-[var(--muted)]">{t("players.inviteCode")}</div>
        <div className="text-2xl font-mono tracking-[0.3em] font-bold">{code}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={copy}>
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </Card>
  );
}
