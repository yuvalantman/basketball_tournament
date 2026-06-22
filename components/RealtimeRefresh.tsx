"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Subscribes to tournament-scoped table changes and refreshes the server
// components (roster, teams, games, status…) so everyone sees updates live —
// players joining, teams dropping, scores going in — without manual reload.
// RLS still applies, so a client only receives changes it's allowed to read.
export function RealtimeRefresh({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Coalesce bursts of changes into a single refresh.
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };

    const scoped = (table: string) => ({
      event: "*" as const,
      schema: "public",
      table,
      filter: `tournament_id=eq.${tournamentId}`,
    });

    const channel = supabase
      .channel(`tournament:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` }, refresh)
      .on("postgres_changes", scoped("tournament_players"), refresh)
      .on("postgres_changes", scoped("teams"), refresh)
      .on("postgres_changes", scoped("games"), refresh)
      .on("postgres_changes", scoped("restrictions"), refresh)
      // team_members has no tournament_id column; listen broadly (RLS scopes it).
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, refresh)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [tournamentId, router]);

  return null;
}
