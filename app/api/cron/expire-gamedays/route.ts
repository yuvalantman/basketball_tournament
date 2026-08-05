import { createAdminClient } from "@/lib/supabase/admin";

// Daily cleanup: a gameday is deleted the day AFTER its date passes
// (cascades its guests/teams/waitlist/restrictions). Triggered by Vercel
// Cron (see vercel.json) — guarded by CRON_SECRET so nobody else can hit it.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { error, count } = await admin
    .from("gamedays")
    .delete({ count: "exact" })
    .lt("date", today);

  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true, deleted: count ?? 0 });
}
