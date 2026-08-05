"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPORTS, overallParam, type SportId } from "@/lib/sports";
import type { ManagerInspection } from "@/lib/types";
import { type ActionResult, requireGroupOwner, requireUser } from "./_shared";

function cleanValues(sport: SportId, values: Record<string, number>): Record<string, number> {
  const allowed = new Set(SPORTS[sport].params.map((p) => p.key));
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(values)) {
    if (!allowed.has(key) || v == null) continue;
    const param = SPORTS[sport].params.find((p) => p.key === key)!;
    out[key] = Math.max(param.scaleMin, Math.min(param.scaleMax, v));
  }
  return out;
}

// Self-service: a rater submits/edits their rating of another group member.
// Partial ratings are fine — only the sport's Overall attribute (if it has
// one) is mandatory. Always weight=1, source='normal' (also enforced by the
// ratings table's RLS WITH CHECK, so this can never be forged from a client
// bypassing the UI).
export async function upsertRating(
  groupId: string,
  rateeId: string,
  values: Record<string, number>,
): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    if (uid === rateeId) return { ok: false, error: "You can't rate yourself." };
    const supabase = await createClient();

    const { data: group } = await supabase.from("groups").select("sport").eq("id", groupId).single();
    if (!group) return { ok: false, error: "Group not found." };
    const sport = group.sport as SportId;

    const clean = cleanValues(sport, values);
    const overall = overallParam(sport);
    if (overall && clean[overall.key] == null) {
      return { ok: false, error: `${overall.label} is required.` };
    }

    const { error } = await supabase.from("ratings").upsert(
      {
        group_id: groupId,
        rater_id: uid,
        ratee_id: rateeId,
        values: clean,
        weight: 1,
        source: "normal",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "group_id,rater_id,ratee_id" },
    );
    if (error) throw new Error(error.message);

    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Prefill: the rater's own existing values for this ratee, or {} if never
// rated. RLS-bound (rater can only ever read their own rows) — no admin
// client needed.
export async function getMyRatingFor(groupId: string, rateeId: string): Promise<ActionResult> {
  try {
    const uid = await requireUser();
    const supabase = await createClient();
    const { data } = await supabase
      .from("ratings")
      .select("values")
      .eq("group_id", groupId)
      .eq("rater_id", uid)
      .eq("ratee_id", rateeId)
      .maybeSingle();
    return { ok: true, data: { values: data?.values ?? {} } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Manager-only: submit/edit a rating with an extra weight multiplier. This is
// the ONLY entry point that can ever produce weight>1/source='manager' — it
// re-verifies the caller is the group's owner server-side (never trusts a
// client-passed flag), then writes via the admin client (bypassing the
// normal-rating RLS policy, which would reject weight>1 anyway).
export async function submitManagerRating(
  groupId: string,
  rateeId: string,
  values: Record<string, number>,
  weightMultiplier: 1 | 2 | 3 | 5,
): Promise<ActionResult> {
  try {
    const ownerId = await requireGroupOwner(groupId);
    if (ownerId === rateeId) return { ok: false, error: "You can't rate yourself." };
    const admin = createAdminClient();

    const { data: group } = await admin.from("groups").select("sport").eq("id", groupId).single();
    if (!group) return { ok: false, error: "Group not found." };
    const sport = group.sport as SportId;

    const clean = cleanValues(sport, values);
    const overall = overallParam(sport);
    if (overall && clean[overall.key] == null) {
      return { ok: false, error: `${overall.label} is required.` };
    }

    const { error } = await admin.from("ratings").upsert(
      {
        group_id: groupId,
        rater_id: ownerId,
        ratee_id: rateeId,
        values: clean,
        weight: weightMultiplier,
        source: "manager",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "group_id,rater_id,ratee_id" },
    );
    if (error) throw new Error(error.message);

    revalidatePath(`/group/${groupId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Manager-only: per-attribute rated-by counts for one player. Counts only —
// never exposes who rated what (mirrors v1's getRatingProgress, which also
// only ever reads rater/ratee pairs, never scores, for this exact reason).
export async function getManagerInspection(groupId: string, rateeId: string): Promise<ActionResult> {
  try {
    const ownerId = await requireGroupOwner(groupId);
    const admin = createAdminClient();

    const { data: group } = await admin.from("groups").select("sport").eq("id", groupId).single();
    if (!group) return { ok: false, error: "Group not found." };
    const sport = group.sport as SportId;

    const { data: rows } = await admin
      .from("ratings")
      .select("rater_id, values")
      .eq("group_id", groupId)
      .eq("ratee_id", rateeId);

    const perParam = SPORTS[sport].params.map((p) => ({
      key: p.key,
      label: p.label,
      raterCount: (rows ?? []).filter((r) => (r.values as Record<string, number>)?.[p.key] != null).length,
    }));
    const overallRaterCount = (rows ?? []).filter(
      (r) => Object.keys((r.values as Record<string, number>) ?? {}).length > 0,
    ).length;

    const myRow = (rows ?? []).find((r) => r.rater_id === ownerId);

    const result: ManagerInspection = {
      user_id: rateeId,
      overallRaterCount,
      perParam,
      myRating: (myRow?.values as Record<string, number>) ?? null,
    };
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
