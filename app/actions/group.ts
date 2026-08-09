"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_DISPLAY_OPTIONS, type DisplayOptions } from "@/lib/constants";
import type { SportId } from "@/lib/sports";
import {
  type ActionResult,
  randomCode,
  requireGroupManager,
  requireGroupMember,
  requireGroupOwner,
  requireUser,
} from "./_shared";

export async function createGroup(input: {
  name: string;
  sport: SportId;
}): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const supabase = await createClient();

    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase
        .from("groups")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = randomCode();
    }

    const { data: group, error } = await supabase
      .from("groups")
      .insert({
        code,
        name: input.name.trim() || "Group",
        sport: input.sport,
        creator_id: uid,
      })
      .select("id")
      .single();
    if (error || !group) throw new Error(error?.message);

    await supabase.from("group_players").insert({ group_id: group.id, user_id: uid });

    revalidatePath("/home");
    return { ok: true, data: { id: group.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function joinGroup(codeInput: string): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const admin = createAdminClient();
    const code = codeInput.trim().toUpperCase();

    const { data: group } = await admin
      .from("groups")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (!group) return { ok: false, error: "No group with that code." };

    await admin
      .from("group_players")
      .upsert({ group_id: group.id, user_id: uid }, { onConflict: "group_id,user_id" });

    revalidatePath("/home");
    return { ok: true, data: { id: group.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Manager-only (creator or co-manager). `sport` is deliberately never
// accepted here — it's immutable after creation.
//
// Uses the admin client for the write, not the RLS-bound one: the groups
// table's own RLS update policy only allows creator_id = auth.uid(), since
// it predates co-managers. Authorization is already fully handled above by
// requireGroupManager, so bypassing RLS here is intentional and safe — using
// the RLS-bound client instead silently no-ops (0 rows matched) for any
// co-manager, which is exactly the bug this comment is here to prevent
// reintroducing.
export async function updateGroupSettings(
  groupId: string,
  patch: { name?: string; display_options?: DisplayOptions },
): Promise<ActionResult> {
  try {
    await requireGroupManager(groupId);
    const admin = createAdminClient();
    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) clean.name = patch.name.trim() || "Group";
    if (patch.display_options !== undefined) clean.display_options = patch.display_options;
    const { error } = await admin.from("groups").update(clean).eq("id", groupId);
    if (error) throw new Error(error.message);
    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Shared cleanup for "this user is leaving this group's roster", whether
// initiated by a manager (removeMember) or by the member themselves
// (leaveGroup) — removes their ratings, gameday participation/waitlist/team
// slots in this group, then the group_players row itself.
async function detachPlayerFromGroup(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  userId: string,
): Promise<void> {
  await admin
    .from("ratings")
    .delete()
    .eq("group_id", groupId)
    .or(`rater_id.eq.${userId},ratee_id.eq.${userId}`);

  // Gamedays in this group the user participates/waitlists/plays in.
  const { data: gamedays } = await admin.from("gamedays").select("id").eq("group_id", groupId);
  const gamedayIds = (gamedays ?? []).map((g) => g.id);
  if (gamedayIds.length) {
    await admin
      .from("gameday_participants")
      .delete()
      .in("gameday_id", gamedayIds)
      .eq("kind", "member")
      .eq("participant_id", userId);
    await admin.from("gameday_waitlist").delete().in("gameday_id", gamedayIds).eq("user_id", userId);
    const { data: teams } = await admin.from("teams").select("id").in("gameday_id", gamedayIds);
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length)
      await admin
        .from("team_members")
        .delete()
        .in("team_id", teamIds)
        .eq("kind", "member")
        .eq("participant_id", userId);
  }

  await admin.from("group_players").delete().eq("group_id", groupId).eq("user_id", userId);
}

// Manager-only (creator or co-manager) removes a member. The creator can
// never be removed, even by another co-manager.
export async function removeMember(groupId: string, userId: string): Promise<ActionResult> {
  try {
    await requireGroupManager(groupId);
    const admin = createAdminClient();
    const { data: group } = await admin.from("groups").select("creator_id").eq("id", groupId).single();
    if (!group) throw new Error("Group not found");
    if (userId === group.creator_id) return { ok: false, error: "The group creator can't be removed." };

    await detachPlayerFromGroup(admin, groupId, userId);

    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Self-service: any member can leave a group they're in — except the
// creator, who'd orphan it (delete the group instead if you want to close it
// entirely).
export async function leaveGroup(groupId: string): Promise<ActionResult> {
  try {
    const uid = await requireGroupMember(groupId);
    const admin = createAdminClient();
    const { data: group } = await admin.from("groups").select("creator_id").eq("id", groupId).single();
    if (!group) throw new Error("Group not found");
    if (uid === group.creator_id)
      return { ok: false, error: "The group creator can't leave. Delete the group instead if you want to close it." };

    await detachPlayerFromGroup(admin, groupId, uid);

    revalidatePath("/home");
    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Manager-only grants (or revokes) a member's rating power — their own
// ratings of others will count `weight`x instead of the default 1x. Only
// self-service ("normal") ratings are affected; see rating.ts's upsertRating.
export async function setMemberRatingWeight(
  groupId: string,
  userId: string,
  weight: 1 | 2 | 3,
): Promise<ActionResult> {
  try {
    await requireGroupManager(groupId);
    const admin = createAdminClient();
    const { error } = await admin
      .from("group_players")
      .update({ rating_weight: weight })
      .eq("group_id", groupId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Manager-only promotes/demotes a co-manager. Any current manager (creator
// or co-manager) can grant or revoke another member's manager status — the
// creator's own status is fixed (always a manager, via creator_id) and can
// never be changed here.
export async function setMemberManagerStatus(
  groupId: string,
  userId: string,
  isManager: boolean,
): Promise<ActionResult> {
  try {
    await requireGroupManager(groupId);
    const admin = createAdminClient();
    const { data: group } = await admin.from("groups").select("creator_id").eq("id", groupId).single();
    if (!group) throw new Error("Group not found");
    if (userId === group.creator_id)
      return { ok: false, error: "The group creator is always a manager." };

    const { error } = await admin
      .from("group_players")
      .update({ is_manager: isManager })
      .eq("group_id", groupId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Owner-only, deletes the group entirely (roster/ratings/gamedays cascade).
export async function deleteGroup(groupId: string): Promise<ActionResult> {
  try {
    await requireGroupOwner(groupId);
    const admin = createAdminClient();
    await admin.from("groups").delete().eq("id", groupId);
    revalidatePath("/home");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type GroupSummary = {
  id: string;
  name: string;
  sport: SportId;
  code: string;
  memberCount: number;
  isManager: boolean;
};

// One query for /home: every group the user is in, with member count and
// whether they manage it. Single round trip (join group_players -> groups,
// then a grouped count) rather than N sequential per-group queries.
export async function getMyGroups(): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const admin = createAdminClient();

    const { data: memberships } = await admin
      .from("group_players")
      .select("group_id, is_manager, groups(id, name, sport, code, creator_id)")
      .eq("user_id", uid);

    const isManagerByGroupId = new Map(
      (memberships ?? []).map((m) => [m.group_id, m.is_manager as boolean]),
    );
    const groups = (memberships ?? [])
      .map((m) => m.groups as unknown as { id: string; name: string; sport: SportId; code: string; creator_id: string } | null)
      .filter((g): g is NonNullable<typeof g> => g != null);

    if (groups.length === 0) return { ok: true, data: { groups: [] } };

    const { data: allPlayers } = await admin
      .from("group_players")
      .select("group_id")
      .in("group_id", groups.map((g) => g.id));

    const counts = new Map<string, number>();
    for (const row of allPlayers ?? []) {
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }

    const summaries: GroupSummary[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      sport: g.sport,
      code: g.code,
      memberCount: counts.get(g.id) ?? 0,
      isManager: g.creator_id === uid || (isManagerByGroupId.get(g.id) ?? false),
    }));

    return { ok: true, data: { groups: summaries, defaults: DEFAULT_DISPLAY_OPTIONS } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
