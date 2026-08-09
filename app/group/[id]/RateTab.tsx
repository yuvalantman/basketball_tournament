"use client";

import { useEffect, useState } from "react";
import { Avatar, Badge, Button, Card, Spinner } from "@/components/ui";
import { HelpTooltip } from "@/components/HelpTooltip";
import { SPORTS, overallParam, paramLabel } from "@/lib/sports";
import type { Group, Profile } from "@/lib/types";
import { getMyRatingFor, upsertRating } from "@/app/actions/rating";
import { useLocale } from "@/lib/i18n/LocaleContext";

export function RateTab({
  group,
  roster,
  myUserId,
  ratedIds,
}: {
  group: Group;
  roster: Profile[];
  myUserId: string;
  ratedIds: string[];
}) {
  const { t, locale } = useLocale();
  const others = roster.filter((p) => p.id !== myUserId);
  const [rated, setRated] = useState<Set<string>>(new Set(ratedIds));
  const [openId, setOpenId] = useState<string | null>(null);
  const overall = overallParam(group.sport);

  return (
    <div className="space-y-4">
      <Card className="bg-[var(--surface-2)]">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold flex items-center gap-1.5">
            {t("rate.yourRatings")}
            <HelpTooltip text={t("help.rate")} />
          </span>
          <span className="text-sm text-[var(--muted)]">
            {t("rate.ratedCount", { rated: rated.size, total: others.length })}
          </span>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {t("rate.alwaysOpenHint", { overall: overall ? paramLabel(overall, locale) : "" })}
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">{t("rate.anonymousHint")}</p>
      </Card>

      <div className="space-y-2">
        {others.map((p) => (
          <RatePlayerCard
            key={p.id}
            group={group}
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
  group,
  player,
  isRated,
  isOpen,
  onToggle,
  onSaved,
}: {
  group: Group;
  player: Profile;
  isRated: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useLocale();
  const sport = SPORTS[group.sport];
  const overall = overallParam(group.sport);
  const [values, setValues] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill with the rater's existing values the first time this card opens.
  useEffect(() => {
    if (!isOpen || loaded) return;
    let cancelled = false;
    getMyRatingFor(group.id, player.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setValues((res.data as { values: Record<string, number> }).values ?? {});
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, loaded, group.id, player.id]);

  const ready = !overall || (values[overall.key] ?? 0) > 0;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await upsertRating(group.id, player.id, values);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  function setParam(key: string, v: number) {
    setValues((s) => ({ ...s, [key]: v }));
  }
  function clearParam(key: string) {
    setValues((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
  }

  return (
    <Card className="p-0 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-start">
        <Avatar src={player.photo_url} name={player.display_name} size={44} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{player.display_name}</div>
          <div className="text-xs text-[var(--muted)]">
            {isRated ? t("rate.tapToEdit") : t("rate.tapToRate")}
          </div>
        </div>
        {isRated ? (
          <Badge className="bg-green-500/15 border-green-500/40 text-green-400">{t("rate.ratedBadge")}</Badge>
        ) : (
          <span className="text-[var(--muted)]">{isOpen ? "▲" : "▼"}</span>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--border)] p-4 space-y-3">
          {!loaded ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : (
            sport.params.map((param) => (
              <div key={param.key} className="flex items-center justify-between gap-3">
                <span className="text-sm w-28 shrink-0">
                  {paramLabel(param, locale)}
                  {param.isOverall && <span className="text-[var(--primary)]"> *</span>}
                </span>
                <div className="flex items-center gap-2">
                  <DotRow
                    min={param.scaleMin}
                    max={param.scaleMax}
                    value={values[param.key] ?? 0}
                    onChange={(v) => setParam(param.key, v)}
                  />
                  {!param.isOverall && values[param.key] != null && (
                    <button
                      onClick={() => clearParam(param.key)}
                      className="text-xs text-[var(--muted)] hover:text-red-400"
                      title={t("rate.clearAttribute")}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {overall && <p className="text-[11px] text-[var(--muted)]">{t("rate.requiredNote")}</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button className="w-full" onClick={save} disabled={!ready || saving || !loaded}>
            {saving ? <Spinner /> : isRated ? t("rate.saveChanges") : t("rate.saveRating")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function DotRow({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap justify-end">
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`h-8 w-8 rounded-lg text-sm font-semibold border transition ${
            n <= value && value > 0
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
