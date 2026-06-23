"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/constants";
import type {
  Game,
  PlayerStats,
  Profile,
  Restriction,
  Team,
  Tournament,
} from "@/lib/types";
import { PlayersTab } from "./PlayersTab";
import { RatingTab } from "./RatingTab";
import { StatsTab } from "./StatsTab";
import { TeamsTab } from "./TeamsTab";
import { BracketTab } from "./BracketTab";
import { CreatorBar } from "./CreatorBar";

type Tab = "players" | "rate" | "stats" | "teams" | "bracket";

export function TournamentView(props: {
  tournament: Tournament;
  isCreator: boolean;
  myUserId: string;
  roster: Profile[];
  restrictions: Restriction[];
  teams: Team[];
  games: Game[];
  ratedIds: string[];
  playerStats: PlayerStats[];
}) {
  const { tournament, isCreator, roster, teams, games, playerStats } = props;
  const status = tournament.status;

  const statsById = useMemo(
    () => new Map(playerStats.map((p) => [p.user_id, p])),
    [playerStats],
  );

  const tabs = useMemo<{ key: Tab; label: string }[]>(() => {
    const list: { key: Tab; label: string }[] = [
      { key: "players", label: "Players" },
    ];
    if (status === "rating") list.push({ key: "rate", label: "Rate" });
    if (status === "teams" || status === "bracket" || status === "done") {
      list.push({ key: "stats", label: "Stats" });
      list.push({ key: "teams", label: "Teams" });
    }
    if (status === "bracket" || status === "done")
      list.push({ key: "bracket", label: "Bracket" });
    return list;
  }, [status]);

  const defaultTab: Tab =
    status === "rating"
      ? "rate"
      : status === "teams"
        ? "teams"
        : status === "bracket" || status === "done"
          ? "bracket"
          : "players";

  const [tab, setTab] = useState<Tab>(defaultTab);
  const active = tabs.some((t) => t.key === tab) ? tab : "players";

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Badge className="bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]">
          {STATUS_LABELS[status]}
        </Badge>
        <span className="text-xs text-[var(--muted)]">
          Code{" "}
          <span className="font-mono tracking-widest text-[var(--foreground)]">
            {tournament.code}
          </span>
        </span>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                active === t.key
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {active === "players" && (
        <PlayersTab
          tournament={tournament}
          isCreator={isCreator}
          roster={roster}
          restrictions={props.restrictions}
        />
      )}
      {active === "rate" && (
        <RatingTab
          tournament={tournament}
          roster={roster}
          myUserId={props.myUserId}
          ratedIds={props.ratedIds}
        />
      )}
      {active === "stats" && <StatsTab stats={props.playerStats} />}
      {active === "teams" && (
        <TeamsTab
          tournament={tournament}
          teams={teams}
          isCreator={isCreator}
          myUserId={props.myUserId}
        />
      )}
      {active === "bracket" && (
        <BracketTab
          tournament={tournament}
          teams={teams}
          games={games}
          isCreator={isCreator}
          myUserId={props.myUserId}
          statsById={statsById}
        />
      )}

      {isCreator && (
        <CreatorBar
          tournament={tournament}
          roster={roster}
          teams={teams}
          games={games}
        />
      )}
    </div>
  );
}
