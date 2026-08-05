import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserId } from "@/lib/supabase/server";

export type ActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

export function randomCode(len = 5): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function requireUser(): Promise<string> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("Not logged in");
  return uid;
}

export async function requireGroupOwner(groupId: string): Promise<string> {
  const uid = await requireUser();
  const admin = createAdminClient();
  const { data } = await admin
    .from("groups")
    .select("creator_id")
    .eq("id", groupId)
    .single();
  if (!data || data.creator_id !== uid)
    throw new Error("Only the group manager can do that");
  return uid;
}

export async function requireGroupMember(groupId: string): Promise<string> {
  const uid = await requireUser();
  const admin = createAdminClient();
  const { data } = await admin
    .from("group_players")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!data) throw new Error("You're not a member of this group");
  return uid;
}

// A gameday's creator OR the group's owner — the two roles allowed to manage
// a gameday (delete it, edit restrictions/teams/waitlist/participants).
export async function requireGamedayManager(gamedayId: string): Promise<{
  uid: string;
  groupId: string;
}> {
  const uid = await requireUser();
  const admin = createAdminClient();
  const { data: gameday } = await admin
    .from("gamedays")
    .select("creator_id, group_id, groups(creator_id)")
    .eq("id", gamedayId)
    .single();
  if (!gameday) throw new Error("Gameday not found");
  const group = gameday.groups as unknown as { creator_id: string } | null;
  if (gameday.creator_id !== uid && group?.creator_id !== uid)
    throw new Error("Only this gameday's creator or the group manager can do that");
  return { uid, groupId: gameday.group_id };
}

export async function getGamedayGroupId(gamedayId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("gamedays")
    .select("group_id")
    .eq("id", gamedayId)
    .single();
  if (!data) throw new Error("Gameday not found");
  return data.group_id;
}
