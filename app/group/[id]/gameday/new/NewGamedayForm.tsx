"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { HelpTooltip } from "@/components/HelpTooltip";
import { GAMEDAY_TEAM_SIZE_MAX, GAMEDAY_TEAM_SIZE_MIN } from "@/lib/constants";
import { SPORTS, overallParam, paramLabel, type SportId } from "@/lib/sports";
import type { Profile } from "@/lib/types";
import type { MissingRatingsInfo } from "@/app/actions/stats";
import { createGameday, addGuest } from "@/app/actions/gameday";
import { upsertRating } from "@/app/actions/rating";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { pluralKey, type Locale } from "@/lib/i18n";

type StagedGuest = {
  tempId: string;
  name: string;
  gender: "M" | "F" | null;
  height_cm: number | null;
  values: Record<string, number>;
};

export function NewGamedayForm({
  groupId,
  sport,
  myUserId,
  roster,
  missingByUserId,
}: {
  groupId: string;
  sport: SportId;
  myUserId: string;
  roster: Profile[];
  missingByUserId: Record<string, MissingRatingsInfo>;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [name, setName] = useState(t("newGameday.defaultName"));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [teamSize, setTeamSize] = useState(5);
  const [selected, setSelected] = useState<Set<string>>(new Set([myUserId]));
  const [guests, setGuests] = useState<StagedGuest[]>([]);
  const [addingGuest, setAddingGuest] = useState(false);
  const [quickRateId, setQuickRateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedMissing = roster.filter((p) => selected.has(p.id) && missingByUserId[p.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await createGameday(groupId, {
      name,
      date,
      teamSize,
      initialUserIds: Array.from(selected),
    });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    const gamedayId = (res.data as { id: string }).id;
    for (const g of guests) {
      await addGuest(gamedayId, { name: g.name, gender: g.gender, height_cm: g.height_cm, photo_url: null }, g.values);
    }
    router.push(`/group/${groupId}/gameday/${gamedayId}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>{t("newGameday.name")}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("newGameday.date")}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label className="flex items-center gap-1.5">
            {t("newGameday.teamSize")}
            <HelpTooltip text={t("help.teamSize")} />
          </Label>
          <Input
            type="number"
            min={GAMEDAY_TEAM_SIZE_MIN}
            max={GAMEDAY_TEAM_SIZE_MAX}
            value={teamSize}
            onChange={(e) => setTeamSize(Number(e.target.value))}
          />
        </div>
      </div>

      {selectedMissing.length > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/40">
          <p className="text-sm text-amber-400 font-medium">
            {t(pluralKey(selectedMissing.length, "newGameday.missingRatingsWarning"), { n: selectedMissing.length })}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">{t("newGameday.missingRatingsHint")}</p>
        </Card>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="mb-0">{t("newGameday.whosComing", { n: selected.size })}</Label>
        </div>
        <div className="space-y-1.5">
          {roster.map((p) => {
            const missing = missingByUserId[p.id];
            const isSelected = selected.has(p.id);
            return (
              <div key={p.id}>
                <button
                  onClick={() => toggle(p.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 border transition text-start ${
                    isSelected
                      ? "border-[var(--primary)] bg-[var(--primary)]/10"
                      : missing
                        ? "border-amber-500/50 bg-amber-500/5"
                        : "border-[var(--border)] bg-[var(--surface-2)]"
                  }`}
                >
                  <Avatar src={p.photo_url} name={p.display_name} size={36} />
                  <span className="flex-1 truncate">{p.display_name}</span>
                  {missing && <Badge className="border-amber-500/50 text-amber-400">{t("newGameday.missingRatingsBadge")}</Badge>}
                  {isSelected && <span className="text-[var(--primary)]">✓</span>}
                </button>
                {isSelected && missing && (
                  <div className="ps-3 mt-1">
                    {quickRateId === p.id ? (
                      <QuickRateForm
                        sport={sport}
                        playerName={p.display_name}
                        onDone={() => {
                          setQuickRateId(null);
                          router.refresh();
                        }}
                        onSubmit={(values) =>
                          upsertRating(groupId, p.id, values, { ignoreGrantedWeight: true })
                        }
                      />
                    ) : (
                      <button onClick={() => setQuickRateId(p.id)} className="text-xs text-amber-400 underline">
                        {t("newGameday.rateNow", { name: p.display_name })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="mb-0">{t("newGameday.guests", { n: guests.length })}</Label>
          <Button size="sm" variant="secondary" onClick={() => setAddingGuest((s) => !s)}>
            {addingGuest ? t("common.cancel") : t("newGameday.addGuest")}
          </Button>
        </div>
        {guests.map((g) => (
          <Card key={g.tempId} className="flex items-center justify-between py-2 mb-1.5">
            <span className="text-sm">{g.name}</span>
            <button
              onClick={() => setGuests((gs) => gs.filter((x) => x.tempId !== g.tempId))}
              className="text-[var(--muted)] hover:text-red-400 text-xs"
            >
              {t("newGameday.remove")}
            </button>
          </Card>
        ))}
        {addingGuest && (
          <GuestForm
            sport={sport}
            onAdd={(g) => {
              setGuests((gs) => [...gs, g]);
              setAddingGuest(false);
            }}
          />
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button className="w-full" size="lg" onClick={submit} disabled={busy || selected.size + guests.length < 2}>
        {busy ? <Spinner /> : t("newGameday.createGameday")}
      </Button>
    </div>
  );
}

// Renders one DotRow per sport param — shared by the guest-add form and the
// quick-rate widget so both use the exact same rating UI as the Rate tab.
function ParamPicker({
  sport,
  locale,
  values,
  onChange,
}: {
  sport: SportId;
  locale: Locale;
  values: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  return (
    <div className="space-y-2">
      {SPORTS[sport].params.map((param) => (
        <div key={param.key} className="flex items-center justify-between gap-3">
          <span className="text-sm w-28 shrink-0">
            {paramLabel(param, locale)}
            {param.isOverall && <span className="text-[var(--primary)]"> *</span>}
          </span>
          <div className="flex gap-1 flex-wrap justify-end">
            {Array.from({ length: param.scaleMax - param.scaleMin + 1 }, (_, i) => param.scaleMin + i).map((n) => (
              <button
                key={n}
                onClick={() => onChange({ ...values, [param.key]: n })}
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
    </div>
  );
}

function GuestForm({ sport, onAdd }: { sport: SportId; onAdd: (g: StagedGuest) => void }) {
  const { t, locale } = useLocale();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F" | null>(null);
  const [height, setHeight] = useState("");
  const [values, setValues] = useState<Record<string, number>>({});

  const overall = overallParam(sport);
  const ready = name.trim().length > 0 && (!overall || (values[overall.key] ?? 0) > 0);

  function add() {
    if (!ready) return;
    onAdd({
      tempId: `${Date.now()}-${Math.random()}`,
      name: name.trim(),
      gender,
      height_cm: height ? Number(height) : null,
      values,
    });
  }

  return (
    <Card className="space-y-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("newGameday.guestNamePlaceholder")} />
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          placeholder={t("newGameday.heightCmPlaceholder")}
        />
        <div className="flex gap-1.5">
          {(["M", "F"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(gender === g ? null : g)}
              className={`flex-1 rounded-xl text-sm font-semibold border transition ${
                gender === g
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-[var(--surface-2)] border-[var(--border)]"
              }`}
            >
              {g === "M" ? t("newGameday.genderM") : t("newGameday.genderF")}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">{t("newGameday.guestRaterHint")}</p>
      <ParamPicker sport={sport} locale={locale} values={values} onChange={setValues} />

      <Button className="w-full" size="sm" onClick={add} disabled={!ready}>
        {t("newGameday.addGuest")}
      </Button>
    </Card>
  );
}

function QuickRateForm({
  sport,
  playerName,
  onDone,
  onSubmit,
}: {
  sport: SportId;
  playerName: string;
  onDone: () => void;
  onSubmit: (values: Record<string, number>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t, locale } = useLocale();
  const [values, setValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overall = overallParam(sport);
  const ready = !overall || (values[overall.key] ?? 0) > 0;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await onSubmit(values);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? t("common.somethingWentWrong"));
      return;
    }
    onDone();
  }

  return (
    <Card className="space-y-2">
      <p className="text-xs text-[var(--muted)]">{t("newGameday.ratingFor", { name: playerName })}</p>
      <ParamPicker sport={sport} locale={locale} values={values} onChange={setValues} />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button size="sm" className="w-full" onClick={save} disabled={!ready || saving}>
        {saving ? <Spinner /> : t("rate.saveRating")}
      </Button>
    </Card>
  );
}
