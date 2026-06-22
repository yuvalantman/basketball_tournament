"use client";

import { Avatar, Badge, Card } from "@/components/ui";
import { RadarChart } from "@/components/RadarChart";
import { PARAM_LABELS, cmToFeet, type RatingParam } from "@/lib/constants";
import type { PlayerStats } from "@/lib/types";

export function StatsTab({ stats }: { stats: PlayerStats[] }) {
  if (!stats || stats.length === 0)
    return (
      <Card className="text-center text-[var(--muted)] py-8">
        Stats appear once rating is closed.
      </Card>
    );

  // Sort by overall when we have it, else by archetype tier.
  const sorted = [...stats].sort(
    (a, b) => (b.overall ?? 0) - (a.overall ?? 0),
  );

  return (
    <div className="space-y-3">
      {sorted.map((p) => (
        <PlayerStatCard key={p.user_id} p={p} />
      ))}
    </div>
  );
}

function PlayerStatCard({ p }: { p: PlayerStats }) {
  const hasNumbers = p.averages != null;
  const hasRadar = p.normalized != null;

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={p.photo_url} name={p.display_name} size={52} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{p.display_name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            {p.archetype && (
              <Badge className="bg-[var(--accent)]/20 border-[var(--accent)]/40 text-[var(--accent)]">
                {p.archetype}
              </Badge>
            )}
            {p.height_cm ? (
              <span className="text-xs text-[var(--muted)]">
                {cmToFeet(p.height_cm)}
              </span>
            ) : null}
          </div>
        </div>
        {p.overall != null && (
          <div className="text-right">
            <div className="text-2xl font-extrabold text-[var(--primary)]">
              {p.rating_mode === "single"
                ? p.overall.toFixed(1)
                : (p.overall * 20).toFixed(0)}
            </div>
            <div className="text-[10px] text-[var(--muted)] uppercase">
              {p.rating_mode === "single" ? "/ 10" : "OVR"}
            </div>
          </div>
        )}
      </div>

      {/* best / worst skill labels (always safe, no numbers) */}
      {p.best_param && (
        <div className="flex gap-2 text-xs">
          <span className="rounded-md bg-green-500/15 text-green-400 px-2 py-1">
            ▲ {PARAM_LABELS[p.best_param as RatingParam]}
          </span>
          {p.worst_param && (
            <span className="rounded-md bg-red-500/10 text-red-400 px-2 py-1">
              ▼ {PARAM_LABELS[p.worst_param as RatingParam]}
            </span>
          )}
        </div>
      )}

      {hasRadar && (
        <div className="flex justify-center">
          <RadarChart
            values={p.normalized!}
            size={hasNumbers ? 200 : 220}
            showSpokeLabels={true}
          />
        </div>
      )}

      {hasNumbers && (
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(p.averages!).map(([param, val]) => (
            <div
              key={param}
              className="rounded-lg bg-[var(--surface-2)] px-2 py-1.5 text-center"
            >
              <div className="text-[10px] text-[var(--muted)] uppercase">
                {PARAM_LABELS[param as RatingParam].slice(0, 4)}
              </div>
              <div className="font-bold">{val.toFixed(1)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
