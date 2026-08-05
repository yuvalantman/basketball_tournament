"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { SPORT_LABELS } from "@/lib/sports";
import type { Group, PlayerCard, Profile } from "@/lib/types";
import type { GamedayWithStatus } from "@/lib/data";
import { PlayersTab } from "./PlayersTab";
import { RateTab } from "./RateTab";
import { PlayerCardsTab } from "./PlayerCardsTab";
import { GameDaysTab } from "./GameDaysTab";

type Tab = "players" | "rate" | "cards" | "gamedays";

export function GroupView(props: {
  group: Group;
  isManager: boolean;
  myUserId: string;
  roster: Profile[];
  ratedIds: string[];
  playerCards: PlayerCard[];
  gamedays: GamedayWithStatus[];
}) {
  const { group, isManager, myUserId, roster, ratedIds, playerCards, gamedays } = props;
  const [tab, setTab] = useState<Tab>("players");

  const tabs: { key: Tab; label: string }[] = [
    { key: "players", label: "Players" },
    { key: "rate", label: "Rate" },
    { key: "cards", label: "Player cards" },
    { key: "gamedays", label: "Game days" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Badge className="bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]">
          {SPORT_LABELS[group.sport]}
        </Badge>
        <span className="text-xs text-[var(--muted)]">
          Code <span className="font-mono tracking-widest text-[var(--foreground)]">{group.code}</span>
        </span>
      </div>

      <div className="flex gap-1 mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "players" && <PlayersTab group={group} isManager={isManager} roster={roster} />}
      {tab === "rate" && (
        <RateTab group={group} roster={roster} myUserId={myUserId} ratedIds={ratedIds} />
      )}
      {tab === "cards" && (
        <PlayerCardsTab group={group} isManager={isManager} cards={playerCards} />
      )}
      {tab === "gamedays" && <GameDaysTab group={group} gamedays={gamedays} />}
    </div>
  );
}
