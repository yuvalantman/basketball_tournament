"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import type { Group } from "@/lib/types";
import type { GamedayWithStatus } from "@/lib/data";
import { joinWaitlist, leaveWaitlist } from "@/app/actions/gameday";

export function GameDaysTab({ group, gamedays }: { group: Group; gamedays: GamedayWithStatus[] }) {
  return (
    <div className="space-y-3">
      <Link href={`/group/${group.id}/gameday/new`} prefetch>
        <Button className="w-full" size="lg">
          + New gameday
        </Button>
      </Link>

      {gamedays.length === 0 ? (
        <Card className="text-center text-[var(--muted)] py-8">No open gamedays yet.</Card>
      ) : (
        gamedays.map((g) => <GamedayRow key={g.id} group={group} gameday={g} />)
      )}
    </div>
  );
}

function GamedayRow({ group, gameday }: { group: Group; gameday: GamedayWithStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleWaitlist() {
    setBusy(true);
    if (gameday.myStatus.kind === "waitlisted") await leaveWaitlist(gameday.id);
    else await joinWaitlist(gameday.id);
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
              {new Date(gameday.date + "T00:00:00").toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}{" "}
              · by {gameday.creatorName}
            </div>
          </div>
          <Badge>
            {gameday.participantCount} player{gameday.participantCount !== 1 ? "s" : ""}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <StatusBadge status={gameday.myStatus} />
          {gameday.myStatus.kind === "none" || gameday.myStatus.kind === "waitlisted" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.preventDefault();
                toggleWaitlist();
              }}
              disabled={busy}
            >
              {busy ? <Spinner /> : gameday.myStatus.kind === "waitlisted" ? "Leave waitlist" : "Join waitlist"}
            </Button>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

function StatusBadge({ status }: { status: GamedayWithStatus["myStatus"] }) {
  if (status.kind === "playing")
    return (
      <span className="text-sm text-green-400 font-medium">You: playing on {status.teamName}</span>
    );
  if (status.kind === "unassigned")
    return <span className="text-sm text-[var(--muted)]">You: in this gameday, no team yet</span>;
  if (status.kind === "waitlisted")
    return <span className="text-sm text-amber-400 font-medium">You: waitlist #{status.position}</span>;
  return <span className="text-sm text-[var(--muted)]">Not in this one</span>;
}
