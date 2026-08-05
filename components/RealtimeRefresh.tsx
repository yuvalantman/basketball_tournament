"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function useDebouncedRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 250);
  };
}

// Subscribes to group-scoped table changes (roster, gamedays list, group
// settings) so everyone sees updates live. RLS still applies. Ratings are
// deliberately NOT subscribed — they're private/anonymous.
export function GroupRealtimeRefresh({ groupId }: { groupId: string }) {
  const refresh = useDebouncedRefresh();

  useEffect(() => {
    const supabase = createClient();
    const scoped = (table: string) => ({
      event: "*" as const,
      schema: "public",
      table,
      filter: `group_id=eq.${groupId}`,
    });

    const channel = supabase
      .channel(`group:${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, refresh)
      .on("postgres_changes", scoped("group_players"), refresh)
      .on("postgres_changes", scoped("gamedays"), refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return null;
}

// Subscribes to one gameday's scoped tables (participants, waitlist, guests,
// restrictions, teams/team_members) so the roster/teams view stays live.
export function GamedayRealtimeRefresh({ gamedayId }: { gamedayId: string }) {
  const refresh = useDebouncedRefresh();

  useEffect(() => {
    const supabase = createClient();
    const scoped = (table: string) => ({
      event: "*" as const,
      schema: "public",
      table,
      filter: `gameday_id=eq.${gamedayId}`,
    });

    const channel = supabase
      .channel(`gameday:${gamedayId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "gamedays", filter: `id=eq.${gamedayId}` }, refresh)
      .on("postgres_changes", scoped("gameday_participants"), refresh)
      .on("postgres_changes", scoped("gameday_waitlist"), refresh)
      .on("postgres_changes", scoped("gameday_guests"), refresh)
      .on("postgres_changes", scoped("gameday_restrictions"), refresh)
      .on("postgres_changes", scoped("teams"), refresh)
      // team_members has no gameday_id column; listen broadly (RLS scopes it).
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamedayId]);

  return null;
}
