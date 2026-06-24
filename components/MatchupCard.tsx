"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toPng } from "html-to-image";
import { Avatar } from "@/components/ui";
import { cmToFeet, overallTo100 } from "@/lib/constants";
import type { PlayerStats, Profile, Team } from "@/lib/types";

function teamAvgHeight(members: Profile[]): string {
  const hs = members.map((m) => m.height_cm).filter((h): h is number => !!h);
  if (!hs.length) return "—";
  return cmToFeet(Math.round(hs.reduce((a, b) => a + b, 0) / hs.length));
}

function teamOverall(members: Profile[], stats: Map<string, PlayerStats>): number | null {
  // Average each player's 70–100 OVR into a team OVR on the same scale.
  const ovrs = members
    .map((m) => {
      const s = stats.get(m.id);
      return s?.overall != null ? overallTo100(s.overall, s.rating_mode) : null;
    })
    .filter((v): v is number => v != null);
  if (!ovrs.length) return null;
  return Math.round(ovrs.reduce((a, b) => a + b, 0) / ovrs.length);
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
          className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
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

          <div className="flex-1 flex flex-col px-3 py-3 max-w-md mx-auto w-full min-h-0">
            <div
              ref={cardRef}
              className="relative flex-1 rounded-2xl overflow-hidden min-h-0"
            >
              {/* Basketball court backdrop */}
              <CourtBackdrop />

              {/* Foreground: one team per half + center VS */}
              <div className="absolute inset-0 flex flex-col">
                <TeamHalf team={teamA} stats={stats} side="top" />

                <motion.div
                  className="relative flex flex-col items-center justify-center py-1 shrink-0"
                  initial={{ scale: 0, rotate: -15 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
                >
                  {label && (
                    <span className="text-[10px] uppercase tracking-[0.3em] text-white/80 mb-0.5 bg-[#0a0a0f]/40 px-2 rounded">
                      {label}
                    </span>
                  )}
                  <span className="text-6xl font-black italic text-[var(--primary)] drop-shadow-[0_0_18px_rgba(249,115,22,0.8)]">
                    VS
                  </span>
                </motion.div>

                <TeamHalf team={teamB} stats={stats} side="bottom" />
              </div>
            </div>

            <motion.p
              className="text-center text-[var(--muted)] text-xs pt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
            >
              tap anywhere to close
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Vertical full-court SVG (two hoops, center circle, keys, 3-pt arcs).
function CourtBackdrop() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 380 660"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c8843d" />
          <stop offset="50%" stopColor="#b9742f" />
          <stop offset="100%" stopColor="#a9652a" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="380" height="660" fill="url(#wood)" />
      <g
        fill="none"
        stroke="#fdf3e3"
        strokeOpacity="0.6"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        {/* boundary */}
        <rect x="14" y="14" width="352" height="632" rx="2" />
        {/* center line + circle */}
        <line x1="14" y1="330" x2="366" y2="330" />
        <circle cx="190" cy="330" r="46" />
        <circle cx="190" cy="330" r="16" />

        {/* ---- top end ---- */}
        <rect x="142" y="14" width="96" height="138" />
        <circle cx="190" cy="152" r="44" />
        <line x1="164" y1="46" x2="216" y2="46" />
        <circle cx="190" cy="54" r="8" />
        <path d="M 56 14 L 56 116 A 150 150 0 0 0 324 116 L 324 14" />

        {/* ---- bottom end ---- */}
        <rect x="142" y="508" width="96" height="138" />
        <circle cx="190" cy="508" r="44" />
        <line x1="164" y1="614" x2="216" y2="614" />
        <circle cx="190" cy="606" r="8" />
        <path d="M 56 646 L 56 544 A 150 150 0 0 1 324 544 L 324 646" />
      </g>
    </svg>
  );
}

function TeamHalf({
  team,
  stats,
  side,
}: {
  team: Team;
  stats: Map<string, PlayerStats>;
  side: "top" | "bottom";
}) {
  const members = team.members ?? [];
  const ovr = teamOverall(members, stats);
  return (
    <motion.div
      className="flex-1 flex flex-col justify-center px-3 min-h-0"
      initial={{ y: side === "top" ? -90 : 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: side === "top" ? 0.2 : 0.55, type: "spring" }}
    >
      <div className="rounded-xl bg-[#0a0a0f]/62 backdrop-blur-[2px] border border-white/15 p-2.5 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-black truncate drop-shadow">{team.name}</h2>
          <div className="text-right shrink-0 pl-2">
            {ovr != null && (
              <div className="text-2xl font-extrabold text-[var(--primary)] leading-none">
                {ovr}
              </div>
            )}
            <div className="text-[10px] text-white/60 uppercase">
              {ovr != null ? "OVR · " : ""}avg {teamAvgHeight(members)}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          {members.map((m) => {
            const s = stats.get(m.id);
            return (
              <div key={m.id} className="flex items-center gap-2.5">
                <Avatar src={m.photo_url} name={m.display_name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate leading-tight">
                    {m.display_name}
                  </div>
                  {s?.archetype && (
                    <div className="text-[10px] text-[var(--accent)] leading-tight">
                      {s.archetype}
                    </div>
                  )}
                </div>
                {m.height_cm && (
                  <span className="text-[11px] text-white/60">
                    {cmToFeet(m.height_cm)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
