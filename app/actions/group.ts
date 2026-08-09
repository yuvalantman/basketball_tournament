"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_DISPLAY_OPTIONS, type DisplayOptions } from "@/lib/constants";
import type { SportId } from "@/lib/sports";
import {
  type ActionResult,
  randomCode,
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

// Owner-only. `sport` is deliberately never accepted here — it's immutable
// after creation.
export async function updateGroupSettings(
  groupId: string,
  patch: { name?: string; display_options?: DisplayOptions },
): Promise<ActionResult> {
  try {
    await requireGroupOwner(groupId);
    const supabase = await createClient();
    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) clean.name = patch.name.trim() || "Group";
    if (patch.display_options !== undefined) clean.display_options = patch.display_options;
    const { error } = await supabase.from("groups").update(clean).eq("id", groupId);
    if (error) throw new Error(error.message);
    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Owner removes a member. Cleans up everything tied to that player in this
// group so ratings/rosters/gamedays stay consistent.
export async function removeMember(groupId: string, userId: string): Promise<ActionResult> {
  try {
    const ownerId = await requireGroupOwner(groupId);
    if (userId === ownerId) return { ok: false, error: "The manager can't be removed." };
    const admin = createAdminClient();

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

    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Owner grants (or revokes) a member's rating power — their own ratings of
// others will count `weight`x instead of the default 1x. Only self-service
// ("normal") ratings are affected; see app/actions/rating.ts's upsertRating.
export async function setMemberRatingWeight(
  groupId: string,
  userId: string,
  weight: 1 | 2 | 3,
): Promise<ActionResult> {
  try {
    await requireGroupOwner(groupId);
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
      .select("group_id, groups(id, name, sport, code, creator_id)")
      .eq("user_id", uid);

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
      isManager: g.creator_id === uid,
    }));

    return { ok: true, data: { groups: summaries, defaults: DEFAULT_DISPLAY_OPTIONS } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
