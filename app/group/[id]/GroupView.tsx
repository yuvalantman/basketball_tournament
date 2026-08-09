"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { SPORT_LABELS, SPORT_LABELS_HE } from "@/lib/sports";
import type { Group, PlayerCard, Profile } from "@/lib/types";
import type { GamedayWithStatus, GroupPlayerMeta } from "@/lib/data";
import { useLocale } from "@/lib/i18n/LocaleContext";
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
  playerMeta: Record<string, GroupPlayerMeta>;
}) {
  const { group, isManager, myUserId, roster, ratedIds, playerCards, gamedays, playerMeta } = props;
  const { t, locale } = useLocale();
  const sportLabels = locale === "he" ? SPORT_LABELS_HE : SPORT_LABELS;
  const [tab, setTab] = useState<Tab>("players");

  const tabs: { key: Tab; label: string }[] = [
    { key: "players", label: t("group.tabPlayers") },
    { key: "rate", label: t("group.tabRate") },
    { key: "cards", label: t("group.tabCards") },
    { key: "gamedays", label: t("group.tabGamedays") },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Badge className="bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]">
          {sportLabels[group.sport]}
        </Badge>
        <span className="text-xs text-[var(--muted)]">
          {t("common.code")} <span className="font-mono tracking-widest text-[var(--foreground)]">{group.code}</span>
        </span>
      </div>

      <div className="flex gap-1 mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 overflow-x-auto">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === tabItem.key ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted)]"
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === "players" && (
        <PlayersTab
          group={group}
          isManager={isManager}
          myUserId={myUserId}
          roster={roster}
          playerMeta={playerMeta}
        />
      )}
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
