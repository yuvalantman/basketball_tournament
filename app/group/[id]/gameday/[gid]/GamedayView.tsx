"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { HelpTooltip } from "@/components/HelpTooltip";
import { Modal } from "@/components/Modal";
import { TeamNameEditor } from "@/components/TeamNameEditor";
import { formatHeight } from "@/lib/constants";
import { SPORTS, overallParam, paramLabel, type SportId } from "@/lib/sports";
import type { Group, Participant, Profile, Team } from "@/lib/types";
import type { GamedayDetail } from "@/lib/data";
import type { TeamStrength } from "@/app/actions/stats";
import type { GamedaySplitMode } from "@/lib/balancing";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  addGuest,
  addParticipant,
  addRestriction,
  addToWaitlist,
  assignGamedayParticipant,
  deleteGameday,
  generateGamedayTeams,
  joinGameday,
  joinWaitlist,
  leaveGamedaySelf,
  leaveWaitlist,
  removeFromGamedayTeam,
  removeFromWaitlist,
  removeGamedayTeams,
  removeParticipant,
  removeRestriction,
  rerollGamedayTeams,
  swapGamedayPlayers,
} from "@/app/actions/gameday";

function pName(p: Participant): string {
  return p.kind === "member" ? p.profile.display_name : p.guest.name;
}
function pPhoto(p: Participant): string | null {
  return p.kind === "member" ? p.profile.photo_url : p.guest.photo_url;
}
function pHeight(p: Participant): number | null {
  return p.kind === "member" ? p.profile.height_cm : p.guest.height_cm;
}
function pRef(p: Participant) {
  return { kind: p.kind, id: p.id };
}

export function GamedayView({
  group,
  detail,
  roster,
  myUserId,
  isManager,
  teamStrength,
}: {
  group: Group;
  detail: GamedayDetail;
  roster: Profile[];
  myUserId: string;
  isManager: boolean;
  // null = not allowed to see it (not a manager, and the group hasn't
  // turned display_options.group_strength on); [] = allowed but no teams yet.
  teamStrength: TeamStrength[] | null;
}) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { gameday, participants, waitlist, teams, restrictions } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [addingGuest, setAddingGuest] = useState(false);
  const [addingRestriction, setAddingRestriction] = useState(false);
  const [waitlistPopupPosition, setWaitlistPopupPosition] = useState<number | null>(null);
  const [splitMode, setSplitMode] = useState<GamedaySplitMode>("reserves");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.error ?? t("common.somethingWentWrong"));
    else router.refresh();
    setBusy(false);
  }

  // Self-join: atomicity/capacity enforcement is entirely server-side (see
  // join_gameday() in supabase/migrations/0007_gameday_self_join.sql) — this
  // just relays whatever the server decided. status: 'joined' needs no
  // special handling (plain refresh); 'waitlisted' pops the modal with the
  // real position; 'already_in'/'already_waitlisted' are idempotent no-ops.
  async function handleJoin() {
    setBusy(true);
    setError(null);
    const res = await joinGameday(gameday.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? t("common.somethingWentWrong"));
      return;
    }
    const data = res.data as { status: string; position?: number };
    if (data.status === "waitlisted") setWaitlistPopupPosition(data.position ?? null);
    router.refresh();
  }

  const assignedRefs = new Set(teams.flatMap((tm) => (tm.members ?? []).map((m) => `${m.kind}:${m.id}`)));
  const unassigned = participants.filter((p) => !assignedRefs.has(`${p.kind}:${p.id}`));
  const memberParticipantIds = new Set(participants.filter((p) => p.kind === "member").map((p) => p.id));
  const availableToAdd = roster.filter((p) => !memberParticipantIds.has(p.id));
  const myWaitlistEntry = waitlist.find((w) => w.user_id === myUserId);
  const iAmParticipant = memberParticipantIds.has(myUserId);

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Card className="flex items-center justify-between">
        <div>
          <div className="text-sm text-[var(--muted)]">
            {new Date(gameday.date + "T00:00:00").toLocaleDateString(locale === "he" ? "he-IL" : "en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className="text-xs text-[var(--muted)]">{t("gamedayView.teamSize", { n: gameday.team_size })}</div>
        </div>
        {isManager && (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (confirm(t("gamedayView.deleteConfirm"))) run(() => deleteGameday(gameday.id));
            }}
          >
            {t("gamedayView.delete")}
          </Button>
        )}
      </Card>

      {gameday.max_players != null ? (
        <>
          {!iAmParticipant && !myWaitlistEntry && (
            <Button
              variant="success"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={handleJoin}
            >
              {busy ? <Spinner /> : t("gamedayView.join")}
            </Button>
          )}
          {iAmParticipant && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => run(() => leaveGamedaySelf(gameday.id))}
            >
              {t("gamedayView.leave")}
            </Button>
          )}
          {myWaitlistEntry && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => run(() => leaveGamedaySelf(gameday.id))}
            >
              {t("gamedayView.leaveWaitlistWithPosition", { n: myWaitlistEntry.position })}
            </Button>
          )}
        </>
      ) : (
        <>
          {/* No cap set on this gameday — unchanged from before self-join
              existed: self-service is waitlist-only, direct participation
              still requires a manager. */}
          {!iAmParticipant && !myWaitlistEntry && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => run(() => joinWaitlist(gameday.id))}
            >
              {t("gamedayView.joinWaitlist")}
            </Button>
          )}
          {myWaitlistEntry && (
            <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(() => leaveWaitlist(gameday.id))}>
              {t("gamedayView.leaveWaitlistWithPosition", { n: myWaitlistEntry.position })}
            </Button>
          )}
        </>
      )}

      {waitlistPopupPosition != null && (
        <Modal onClose={() => setWaitlistPopupPosition(null)}>
          <p className="font-semibold mb-1 pe-4">{t("gamedayView.gamedayFullTitle")}</p>
          <p className="text-sm text-[var(--muted)] pe-4">
            {t("gamedayView.waitlistedWithPosition", { position: waitlistPopupPosition })}
          </p>
        </Modal>
      )}

      {isManager && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs font-medium text-[var(--muted)]">{t("gamedayView.splitMode")}</span>
              <HelpTooltip text={t("help.splitMode")} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSplitMode("reserves")}
                className={`rounded-xl py-2 text-xs font-semibold border transition ${
                  splitMode === "reserves"
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {t("gamedayView.splitModeReserves")}
              </button>
              <button
                type="button"
                onClick={() => setSplitMode("extra_team")}
                className={`rounded-xl py-2 text-xs font-semibold border transition ${
                  splitMode === "extra_team"
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {t("gamedayView.splitModeExtraTeam")}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              className="flex-1"
              disabled={busy || participants.length < 2}
              onClick={() => run(() => generateGamedayTeams(gameday.id, splitMode))}
            >
              {teams.length === 0 ? t("gamedayView.generateTeams") : t("gamedayView.rerollTeams")}
            </Button>
            <HelpTooltip text={t("help.generateTeams")} />

            {teams.length > 0 && (
              <Button variant={swapMode ? "primary" : "secondary"} onClick={() => setSwapMode((s) => !s)}>
                {swapMode ? t("gamedayView.doneSwapping") : t("gamedayView.swapPlayers")}
              </Button>
            )}
          </div>

          {teams.length > 0 && !swapMode && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (confirm(t("gamedayView.removeTeamsConfirm"))) run(() => removeGamedayTeams(gameday.id));
              }}
            >
              {t("gamedayView.removeTeams")}
            </Button>
          )}
        </div>
      )}

      {teams.length === 0 || swapMode ? null : (
        <TeamsDisplay
          teams={teams}
          gamedayId={gameday.id}
          myUserId={myUserId}
          isManager={isManager}
          sport={group.sport}
          teamStrength={teamStrength}
          onChanged={() => router.refresh()}
        />
      )}

      {swapMode && (
        <SwapUI
          gamedayId={gameday.id}
          teams={teams}
          onDone={() => {
            setSwapMode(false);
            router.refresh();
          }}
        />
      )}

      {teams.length > 0 && unassigned.length > 0 && !swapMode && (
        <UnassignedCard
          gamedayId={gameday.id}
          participants={unassigned}
          teams={teams}
          isManager={isManager}
          onDone={() => router.refresh()}
        />
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("gamedayView.playersCount", { n: participants.length })}</h3>
        </div>
        <div className="space-y-1.5">
          {participants.map((p) => (
            <div key={`${p.kind}:${p.id}`} className="flex items-center gap-3">
              <Avatar src={pPhoto(p)} name={pName(p)} size={32} />
              <span className="flex-1 truncate text-sm">{pName(p)}</span>
              {p.kind === "guest" && <Badge>{t("gamedayView.guestBadge")}</Badge>}
              {pHeight(p) && <span className="text-xs text-[var(--muted)]">{formatHeight(pHeight(p))}</span>}
              {isManager && (
                <button
                  onClick={() => {
                    if (p.kind === "member") run(() => removeParticipant(gameday.id, p.id));
                  }}
                  className="text-[var(--muted)] hover:text-red-400 px-1 text-xs"
                  title={t("gamedayView.removeFromGamedayTitle")}
                >
                  {p.kind === "member" ? "✕" : ""}
                </button>
              )}
            </div>
          ))}
        </div>

        {isManager && availableToAdd.length > 0 && (
          <AddMemberPicker
            options={availableToAdd}
            onAdd={(userId) => run(() => addParticipant(gameday.id, userId))}
          />
        )}
        {isManager && (
          <Button size="sm" variant="secondary" onClick={() => setAddingGuest((s) => !s)}>
            {addingGuest ? t("common.cancel") : t("gamedayView.addGuest")}
          </Button>
        )}
        {isManager && addingGuest && (
          <AddGuestForm
            sport={group.sport}
            gamedayId={gameday.id}
            onDone={() => {
              setAddingGuest(false);
              router.refresh();
            }}
          />
        )}
      </Card>

      {waitlist.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">{t("gamedayView.waitingList")}</h3>
          {waitlist.map((w) => (
            <div key={w.user_id} className="flex items-center gap-3">
              <span className="text-xs font-bold text-[var(--muted)] w-5">{w.position}</span>
              <Avatar src={w.profile?.photo_url} name={w.profile?.display_name ?? "?"} size={28} />
              <span className="flex-1 truncate text-sm">{w.profile?.display_name}</span>
              {isManager && (
                <button
                  onClick={() => run(() => removeFromWaitlist(gameday.id, w.user_id))}
                  className="text-[var(--muted)] hover:text-red-400 text-xs"
                >
                  {t("newGameday.remove")}
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {isManager && availableToAdd.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-2 text-sm">{t("gamedayView.addToWaitlist")}</h3>
          <AddMemberPicker
            options={availableToAdd}
            onAdd={(userId) => run(() => addToWaitlist(gameday.id, userId))}
          />
        </Card>
      )}

      {isManager && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t("gamedayView.keepApartTogether")}</h3>
            <Button size="sm" variant="secondary" onClick={() => setAddingRestriction((s) => !s)}>
              {addingRestriction ? t("common.cancel") : t("common.add")}
            </Button>
          </div>
          {restrictions.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm bg-[var(--surface-2)] rounded-lg px-3 py-2">
              <span>
                {pName(r.a)} <span className="text-[var(--muted)]">{r.kind === "apart" ? "⊗" : "🤝"}</span> {pName(r.b)}
              </span>
              <button onClick={() => run(() => removeRestriction(gameday.id, r.id))} className="text-[var(--muted)] hover:text-red-400">
                ✕
              </button>
            </div>
          ))}
          {addingRestriction && (
            <RestrictionForm
              participants={participants}
              onAdd={(kind, a, b) => run(() => addRestriction(gameday.id, kind, a, b))}
            />
          )}
        </Card>
      )}
    </div>
  );
}

function TeamsDisplay({
  teams,
  gamedayId,
  myUserId,
  isManager,
  sport,
  teamStrength,
  onChanged,
}: {
  teams: Team[];
  gamedayId: string;
  myUserId: string;
  isManager: boolean;
  sport: SportId;
  teamStrength: TeamStrength[] | null;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [inspectingTeamId, setInspectingTeamId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {teams.map((tm) => {
        const canEdit = isManager || (tm.members ?? []).some((m) => m.kind === "member" && m.id === myUserId);
        const strength = teamStrength?.find((s) => s.teamId === tm.id);
        return (
          <Card key={tm.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <TeamNameEditor gamedayId={gamedayId} team={tm} canEdit={canEdit} onDone={onChanged} />
              <div className="flex items-center gap-2 shrink-0">
                {strength?.averageScore != null && (
                  <span className="text-xs text-[var(--muted)]">
                    {t("gamedayView.averageScore", { score: strength.averageScore })}
                  </span>
                )}
                <Badge>{t("gamedayView.playersCountBadge", { n: (tm.members ?? []).length })}</Badge>
              </div>
            </div>
            <div className="space-y-1.5">
              {(tm.members ?? []).map((m) => (
                <div key={`${m.kind}:${m.id}`} className="flex items-center gap-3">
                  <Avatar src={pPhoto(m)} name={pName(m)} size={32} />
                  <span className="flex-1 truncate text-sm">{pName(m)}</span>
                  {pHeight(m) && <span className="text-xs text-[var(--muted)]">{formatHeight(pHeight(m))}</span>}
                  {m.kind === "guest" && <Badge>{t("gamedayView.guestBadge")}</Badge>}
                  {m.is_reserve && <Badge className="border-amber-500/50 text-amber-400">{t("gamedayView.reserveBadge")}</Badge>}
                  {isManager && (
                    <button
                      type="button"
                      onClick={async () => {
                        await removeFromGamedayTeam(gamedayId, pRef(m));
                        onChanged();
                      }}
                      className="text-xs text-[var(--muted)] hover:text-amber-400 px-1"
                      title={t("gamedayView.benchTitle")}
                    >
                      {t("gamedayView.bench")}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isManager && strength && (
              <button
                type="button"
                onClick={() => setInspectingTeamId((id) => (id === tm.id ? null : tm.id))}
                className="text-xs text-[var(--muted)] hover:text-[var(--primary)] self-start"
              >
                {inspectingTeamId === tm.id ? t("cards.hideInspection") : t("cards.inspectRatings")}
              </button>
            )}
            {isManager && inspectingTeamId === tm.id && strength && (
              <TeamInspectPanel sport={sport} strength={strength} />
            )}
          </Card>
        );
      })}
    </div>
  );
}

function TeamInspectPanel({ sport, strength }: { sport: SportId; strength: TeamStrength }) {
  const { t, locale } = useLocale();
  const sportConfig = SPORTS[sport];
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
        {t("cards.fullAverages")}
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-sm">
        {sportConfig.params.map((param) =>
          strength.perParam[param.key] != null ? (
            <div key={param.key} className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5">
              <span className="text-[var(--muted)]">{paramLabel(param, locale)}</span>
              <span className="font-semibold">{strength.perParam[param.key]}</span>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function UnassignedCard({
  gamedayId,
  participants,
  teams,
  isManager,
  onDone,
}: {
  gamedayId: string;
  participants: Participant[];
  teams: Team[];
  isManager: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  return (
    <Card className="space-y-3 border-amber-500/40">
      <div>
        <h3 className="font-semibold">{t("gamedayView.notOnTeamYet")}</h3>
      </div>
      <div className="space-y-2">
        {participants.map((p) => (
          <div key={`${p.kind}:${p.id}`} className="flex items-center gap-2">
            <Avatar src={pPhoto(p)} name={pName(p)} size={32} />
            <span className="flex-1 truncate text-sm">{pName(p)}</span>
            {isManager && <AssignPicker gamedayId={gamedayId} participant={pRef(p)} teams={teams} onDone={onDone} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AssignPicker({
  gamedayId,
  participant,
  teams,
  onDone,
}: {
  gamedayId: string;
  participant: { kind: "member" | "guest"; id: string };
  teams: Team[];
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!teamId) return;
    setBusy(true);
    await assignGamedayParticipant(gamedayId, participant, teamId);
    setBusy(false);
    onDone();
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <select
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1.5 text-xs max-w-[120px]"
      >
        <option value="">{t("gamedayView.teamPickerPlaceholder")}</option>
        {teams.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {tm.name} ({(tm.members ?? []).length})
          </option>
        ))}
      </select>
      <Button size="sm" onClick={assign} disabled={busy || !teamId}>
        {busy ? <Spinner /> : t("common.add")}
      </Button>
    </div>
  );
}

function SwapUI({ gamedayId, teams, onDone }: { gamedayId: string; teams: Team[]; onDone: () => void }) {
  const { t } = useLocale();
  const [sel, setSel] = useState<{ teamId: string; ref: { kind: "member" | "guest"; id: string } } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(teamId: string, ref: { kind: "member" | "guest"; id: string }) {
    if (!sel) {
      setSel({ teamId, ref });
      return;
    }
    if (sel.ref.kind === ref.kind && sel.ref.id === ref.id) {
      setSel(null);
      return;
    }
    if (sel.teamId === teamId) {
      setSel({ teamId, ref });
      return;
    }
    setBusy(true);
    await swapGamedayPlayers(gamedayId, sel.ref, sel.teamId, ref, teamId);
    setSel(null);
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        {t("gamedayView.swapHint")}
        {busy && t("gamedayView.swapping")}
      </p>
      {teams.map((tm) => (
        <Card key={tm.id} className="space-y-2">
          <h3 className="font-bold">{tm.name}</h3>
          <div className="space-y-1.5">
            {(tm.members ?? []).map((m) => {
              const selected = sel?.ref.kind === m.kind && sel?.ref.id === m.id;
              return (
                <button
                  key={`${m.kind}:${m.id}`}
                  onClick={() => pick(tm.id, { kind: m.kind, id: m.id })}
                  className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 border transition ${
                    selected ? "border-[var(--primary)] bg-[var(--primary)]/15" : "border-transparent"
                  }`}
                >
                  <Avatar src={pPhoto(m)} name={pName(m)} size={32} />
                  <span className="flex-1 text-start truncate">{pName(m)}</span>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function AddMemberPicker({ options, onAdd }: { options: Profile[]; onAdd: (userId: string) => void }) {
  const { t } = useLocale();
  const [userId, setUserId] = useState("");
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="flex-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1.5 text-sm"
      >
        <option value="">{t("gamedayView.addPlayerPlaceholder")}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        onClick={() => {
          if (userId) {
            onAdd(userId);
            setUserId("");
          }
        }}
        disabled={!userId}
      >
        {t("common.add")}
      </Button>
    </div>
  );
}

function AddGuestForm({ sport, gamedayId, onDone }: { sport: SportId; gamedayId: string; onDone: () => void }) {
  const { t, locale } = useLocale();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F" | null>(null);
  const [height, setHeight] = useState("");
  const [values, setValues] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overall = overallParam(sport);
  const ready = name.trim().length > 0 && (!overall || (values[overall.key] ?? 0) > 0);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await addGuest(
      gamedayId,
      { name: name.trim(), gender, height_cm: height ? Number(height) : null, photo_url: null },
      values,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
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
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button className="w-full" size="sm" onClick={submit} disabled={!ready || busy}>
        {busy ? <Spinner /> : t("newGameday.addGuest")}
      </Button>
    </Card>
  );
}

function RestrictionForm({
  participants,
  onAdd,
}: {
  participants: Participant[];
  onAdd: (kind: "apart" | "together", a: { kind: "member" | "guest"; id: string }, b: { kind: "member" | "guest"; id: string }) => void;
}) {
  const { t } = useLocale();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [kind, setKind] = useState<"apart" | "together">("apart");

  function refFromValue(v: string): { kind: "member" | "guest"; id: string } | null {
    if (!v) return null;
    const [k, id] = v.split(":");
    return { kind: k as "member" | "guest", id };
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select value={a} onChange={(e) => setA(e.target.value)} className="flex-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm">
          <option value="">{t("gamedayView.playerA")}</option>
          {participants.map((p) => (
            <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
              {pName(p)}
            </option>
          ))}
        </select>
        <select value={b} onChange={(e) => setB(e.target.value)} className="flex-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm">
          <option value="">{t("gamedayView.playerB")}</option>
          {participants.map((p) => (
            <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
              {pName(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        {(["apart", "together"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold border transition ${
              kind === k
                ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                : "bg-[var(--surface-2)] border-[var(--border)]"
            }`}
          >
            {k === "apart" ? t("gamedayView.keepApart") : t("gamedayView.keepTogether")}
          </button>
        ))}
        <Button
          size="sm"
          onClick={() => {
            const refA = refFromValue(a);
            const refB = refFromValue(b);
            if (refA && refB) {
              onAdd(kind, refA, refB);
              setA("");
              setB("");
            }
          }}
        >
          {t("common.add")}
        </Button>
      </div>
    </div>
  );
}
