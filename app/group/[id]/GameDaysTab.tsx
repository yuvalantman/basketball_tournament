"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { HelpTooltip } from "@/components/HelpTooltip";
import type { Group } from "@/lib/types";
import type { GamedayWithStatus } from "@/lib/data";
import { joinWaitlist, leaveWaitlist } from "@/app/actions/gameday";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { pluralKey } from "@/lib/i18n";

export function GameDaysTab({ group, gamedays }: { group: Group; gamedays: GamedayWithStatus[] }) {
  const { t } = useLocale();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 px-1">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">{t("gamedays.heading")}</h2>
        <HelpTooltip text={t("help.gamedays")} />
      </div>
      <Link href={`/group/${group.id}/gameday/new`} prefetch>
        <Button className="w-full" size="lg">
          {t("gamedays.newGameday")}
        </Button>
      </Link>

      {gamedays.length === 0 ? (
        <Card className="text-center text-[var(--muted)] py-8">{t("gamedays.noneYet")}</Card>
      ) : (
        gamedays.map((g) => <GamedayRow key={g.id} group={group} gameday={g} />)
      )}
    </div>
  );
}

function GamedayRow({ group, gameday }: { group: Group; gameday: GamedayWithStatus }) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [busy, setBusy] = useState(false);
  // Optimistic override: flips immediately on click so the button/status
  // updates in the same frame, rather than waiting for the full server
  // round trip + page refresh. Reconciled with the real server state once
  // router.refresh() lands (or reverted if the action fails).
  const [override, setOverride] = useState<"none" | "waitlisted" | null>(null);
  const status = override
    ? override === "waitlisted"
      ? { kind: "waitlisted" as const, position: gameday.myStatus.kind === "waitlisted" ? gameday.myStatus.position : 0 }
      : { kind: "none" as const }
    : gameday.myStatus;

  async function toggleWaitlist() {
    const wasWaitlisted = status.kind === "waitlisted";
    setOverride(wasWaitlisted ? "none" : "waitlisted");
    setBusy(true);
    const res = wasWaitlisted ? await leaveWaitlist(gameday.id) : await joinWaitlist(gameday.id);
    if (!res.ok) setOverride(wasWaitlisted ? "waitlisted" : "none");
    router.refresh();
    setBusy(false);
  }

  return (
    <Link href={`/group/${group.id}/gameday/${gameday.id}`} prefetch>
      <Card className="space-y-2 hover:border-[var(--primary)] transition">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{gameday.name}</div>
            <div className="text-xs text-[var(--muted)]">
              {new Date(gameday.date + "T00:00:00").toLocaleDateString(locale === "he" ? "he-IL" : "en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}{" "}
              · {t("gamedays.byCreator", { name: gameday.creatorName })}
            </div>
          </div>
          <Badge>{gameday.participantCount} {t(pluralKey(gameday.participantCount, "gamedays.playerCount"))}</Badge>
        </div>

        <div className="flex items-center justify-between">
          <StatusBadge status={status} />
          {status.kind === "none" || status.kind === "waitlisted" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.preventDefault();
                toggleWaitlist();
              }}
              disabled={busy}
            >
              {status.kind === "waitlisted" ? t("gamedays.leaveWaitlist") : t("gamedays.joinWaitlist")}
            </Button>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

function StatusBadge({ status }: { status: GamedayWithStatus["myStatus"] }) {
  const { t } = useLocale();
  if (status.kind === "playing")
    return (
      <span className="text-sm text-green-400 font-medium">{t("gamedays.playingOn", { team: status.teamName })}</span>
    );
  if (status.kind === "unassigned")
    return <span className="text-sm text-[var(--muted)]">{t("gamedays.noTeamYet")}</span>;
  if (status.kind === "waitlisted")
    return <span className="text-sm text-amber-400 font-medium">{t("gamedays.waitlistPosition", { n: status.position })}</span>;
  return <span className="text-sm text-[var(--muted)]">{t("gamedays.notInThisOne")}</span>;
}
