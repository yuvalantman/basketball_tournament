"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toPng } from "html-to-image";
import { Avatar } from "@/components/ui";
import { cmToFeet } from "@/lib/constants";
import type { PlayerStats, Profile, Team } from "@/lib/types";

function teamAvgHeight(members: Profile[]): string {
  const hs = members.map((m) => m.height_cm).filter((h): h is number => !!h);
  if (!hs.length) return "—";
  return cmToFeet(Math.round(hs.reduce((a, b) => a + b, 0) / hs.length));
}

function teamOverall(members: Profile[], stats: Map<string, PlayerStats>): number | null {
  const ovrs = members
    .map((m) => stats.get(m.id)?.overall)
    .filter((v): v is number => v != null);
  if (!ovrs.length) return null;
  const avg = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
  // 8-param overall is 1..5 -> scale to /100; single is already 1..10 -> /10*100.
  const mode = stats.get(members[0]?.id)?.rating_mode;
  return mode === "single" ? avg * 10 : avg * 20;
}

export function MatchupCard({
  open,
  onClose,
  teamA,
  teamB,
  stats,
  label,
}: {
  open: boolean;
  onClose: () => void;
  teamA: Team | null;
  teamB: Team | null;
  stats: Map<string, PlayerStats>;
  label?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        // inline images (avatars) via fetch so the canvas isn't tainted
        cacheBust: true,
        backgroundColor: "#0a0a0f",
      });
      const a = document.createElement("a");
      a.download = `${teamA?.name ?? "team"}-vs-${teamB?.name ?? "team"}.png`;
      a.href = dataUrl;
      a.click();
    } catch {
      // best-effort; ignore if the browser blocks the export
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && teamA && teamB && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            background:
              "radial-gradient(circle at 50% 0%, #1e1e2d 0%, #0a0a0f 70%)",
          }}
        >
          <div
            className="flex items-center justify-end gap-2 px-4 pt-4 max-w-md mx-auto w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={download}
              disabled={downloading}
              className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {downloading ? "Saving…" : "⬇ Download"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              ✕
            </button>
          </div>
          <div
            ref={cardRef}
            className="flex-1 flex flex-col justify-center px-4 max-w-md mx-auto w-full"
          >
            {label && (
              <motion.div
                className="text-center text-[var(--muted)] uppercase tracking-[0.3em] text-xs mb-6"
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                {label}
              </motion.div>
            )}

            <TeamColumn team={teamA} stats={stats} side="left" />

            <motion.div
              className="text-center my-3"
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.35, type: "spring", stiffness: 200 }}
            >
              <span className="text-5xl font-black italic text-[var(--primary)] drop-shadow-[0_0_20px_rgba(249,115,22,0.5)]">
                VS
              </span>
            </motion.div>

            <TeamColumn team={teamB} stats={stats} side="right" />
          </div>

          <motion.p
            className="text-center text-[var(--muted)] text-xs pb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
          >
            tap anywhere to close
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TeamColumn({
  team,
  stats,
  side,
}: {
  team: Team;
  stats: Map<string, PlayerStats>;
  side: "left" | "right";
}) {
  const members = team.members ?? [];
  const ovr = teamOverall(members, stats);
  return (
    <motion.div
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur p-4"
      initial={{ x: side === "left" ? -120 : 120, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: side === "left" ? 0.2 : 0.5, type: "spring" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-black">{team.name}</h2>
        <div className="text-right">
          {ovr != null && (
            <div className="text-2xl font-extrabold text-[var(--primary)] leading-none">
              {ovr.toFixed(0)}
            </div>
          )}
          <div className="text-[10px] text-[var(--muted)] uppercase">
            avg {teamAvgHeight(members)}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {members.map((m) => {
          const s = stats.get(m.id);
          return (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar src={m.photo_url} name={m.display_name} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate leading-tight">
                  {m.display_name}
                </div>
                {s?.archetype && (
                  <div className="text-[11px] text-[var(--accent)]">
                    {s.archetype}
                  </div>
                )}
              </div>
              {m.height_cm && (
                <span className="text-xs text-[var(--muted)]">
                  {cmToFeet(m.height_cm)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
