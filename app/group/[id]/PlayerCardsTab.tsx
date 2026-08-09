"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, Card, Spinner } from "@/components/ui";
import { HelpTooltip } from "@/components/HelpTooltip";
import { RadarChart } from "@/components/RadarChart";
import { formatHeight, GENDER_LABELS, GENDER_LABELS_HE } from "@/lib/constants";
import { SPORTS, overallParam, paramLabel } from "@/lib/sports";
import type { Group, ManagerInspection, PlayerCard } from "@/lib/types";
import { getManagerInspection, submitManagerRating } from "@/app/actions/rating";
import { useLocale } from "@/lib/i18n/LocaleContext";

export function PlayerCardsTab({
  group,
  isManager,
  cards,
}: {
  group: Group;
  isManager: boolean;
  cards: PlayerCard[];
}) {
  const { t } = useLocale();
  const sorted = [...cards].sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  if (sorted.length === 0) {
    return <Card className="text-center text-[var(--muted)] py-8">{t("cards.noPlayersYet")}</Card>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 px-1 -mb-1">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">{t("cards.heading")}</h2>
        <HelpTooltip text={t("help.cards")} />
      </div>
      {sorted.map((c) => (
        <PlayerCardItem key={c.user_id} group={group} isManager={isManager} card={c} />
      ))}
    </div>
  );
}

function PlayerCardItem({
  group,
  isManager,
  card,
}: {
  group: Group;
  isManager: boolean;
  card: PlayerCard;
}) {
  const { t, locale } = useLocale();
  const genderLabels = locale === "he" ? GENDER_LABELS_HE : GENDER_LABELS;
  const sport = SPORTS[group.sport];
  const [inspecting, setInspecting] = useState(false);
  const prefetched = useRef<Promise<unknown> | null>(null);

  function prefetch() {
    if (!prefetched.current) prefetched.current = getManagerInspection(group.id, card.user_id);
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={card.photo_url} name={card.display_name} size={48} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{card.display_name}</div>
          <div className="text-xs text-[var(--muted)] flex gap-2 flex-wrap">
            {card.height_cm && <span>{formatHeight(card.height_cm)}</span>}
            {card.gender && <span>{genderLabels[card.gender]}</span>}
          </div>
        </div>
        {card.overall != null && (
          <div className="text-end">
            <div className="text-2xl font-extrabold">{card.overall}</div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">{t("cards.ovr")}</div>
          </div>
        )}
      </div>

      {card.archetype && (
        <div className="flex items-center gap-2">
          <Badge className="bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]">
            {card.archetype}
          </Badge>
          {card.archetype_tier && <Badge>{card.archetype_tier}</Badge>}
        </div>
      )}

      {(card.best_param || card.worst_param) && (
        <div className="flex gap-4 text-sm">
          {card.best_param && (
            <span>
              <span className="text-[var(--muted)]">{t("cards.best")}</span>{" "}
              {(() => {
                const p = sport.params.find((sp) => sp.key === card.best_param);
                return p ? paramLabel(p, locale) : card.best_param;
              })()}
            </span>
          )}
          {card.worst_param && (
            <span>
              <span className="text-[var(--muted)]">{t("cards.needsWork")}</span>{" "}
              {(() => {
                const p = sport.params.find((sp) => sp.key === card.worst_param);
                return p ? paramLabel(p, locale) : card.worst_param;
              })()}
            </span>
          )}
        </div>
      )}

      {card.normalized && (
        <div className="flex justify-center">
          <RadarChart values={card.normalized} params={sport.params} size={180} />
        </div>
      )}

      {card.averages && (
        <div className="grid grid-cols-2 gap-2">
          {sport.params.map((p) =>
            card.averages![p.key] != null ? (
              <div
                key={p.key}
                className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-sm"
              >
                <span className="text-[var(--muted)]">{paramLabel(p, locale)}</span>
                <span className="font-semibold">{card.averages![p.key]}</span>
              </div>
            ) : null,
          )}
        </div>
      )}

      {card.raterCount === 0 && (
        <p className="text-xs text-[var(--muted)]">{t("cards.noRatingsYet")}</p>
      )}

      {isManager && (
        <button
          onMouseEnter={prefetch}
          onFocus={prefetch}
          onClick={() => setInspecting((s) => !s)}
          className="text-xs text-[var(--muted)] hover:text-[var(--primary)] self-start"
        >
          {inspecting ? t("cards.hideInspection") : t("cards.inspectRatings")}
        </button>
      )}
      {isManager && inspecting && (
        <InspectPanel group={group} userId={card.user_id} prefetched={prefetched.current} />
      )}
    </Card>
  );
}

function InspectPanel({
  group,
  userId,
  prefetched,
}: {
  group: Group;
  userId: string;
  prefetched: Promise<unknown> | null;
}) {
  const { t, locale } = useLocale();
  const sport = SPORTS[group.sport];
  const [data, setData] = useState<ManagerInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, number>>({});
  const [weight, setWeight] = useState<1 | 2 | 3 | 5>(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const p = prefetched ?? getManagerInspection(group.id, userId);
    p.then((res) => {
      if (cancelled) return;
      const r = res as { ok: boolean; data?: ManagerInspection; error?: string };
      if (r.ok && r.data) {
        setData(r.data);
        setValues(r.data.myRating ?? {});
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, userId]);

  const overall = overallParam(group.sport);
  const ready = !overall || (values[overall.key] ?? 0) > 0;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await submitManagerRating(group.id, userId, values, weight);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-3 border-t border-[var(--border)]">
        <Spinner />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="border-t border-[var(--border)] pt-3 space-y-3">
      <div>
        <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
          {t("cards.ratedByPerAttribute")}
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-sm">
          {data.perParam.map((p) => {
            const sp = sport.params.find((x) => x.key === p.key);
            return (
              <div key={p.key} className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5">
                <span className="text-[var(--muted)]">{sp ? paramLabel(sp, locale) : p.label}</span>
                <span className="font-semibold">{p.raterCount}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
          {t("cards.rateAsManager")}
        </div>
        {sport.params.map((param) => (
          <div key={param.key} className="flex items-center justify-between gap-3">
            <span className="text-sm w-28 shrink-0">
              {paramLabel(param, locale)}
              {param.isOverall && <span className="text-[var(--primary)]"> *</span>}
            </span>
            <div className="flex gap-1 flex-wrap justify-end">
              {Array.from({ length: param.scaleMax - param.scaleMin + 1 }, (_, i) => param.scaleMin + i).map((n) => (
                <button
                  key={n}
                  onClick={() => setValues((v) => ({ ...v, [param.key]: n }))}
                  className={`h-7 w-7 rounded-md text-xs font-semibold border transition ${
                    (values[param.key] ?? 0) >= n && (values[param.key] ?? 0) > 0
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                      : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t("cards.weight")}</span>
          <div className="flex gap-1.5">
            {([1, 2, 3, 5] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWeight(w)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
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

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {saved && <p className="text-green-400 text-sm">{t("common.saved")}</p>}
        <Button className="w-full" size="sm" onClick={save} disabled={!ready || saving}>
          {saving ? <Spinner /> : t("cards.saveManagerRating")}
        </Button>
      </div>
    </div>
  );
}
