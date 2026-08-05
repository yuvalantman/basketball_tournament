// Seed one group per sport (basketball/soccer/volleyball) with fake players,
// ratings, and a sample gameday (including a guest and a waitlisted member)
// so you can walk the whole flow immediately. Requires a real Supabase
// project + the keys in .env.local (incl. SUPABASE_SERVICE_ROLE_KEY).
//
//   npm run seed
//
// Prints a login you can use at the end.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SPORTS, type SportConfig, type SportId } from "../lib/sports";

// Load .env.local manually (tsx doesn't do it automatically).
function loadEnv() {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DOMAIN = process.env.NEXT_PUBLIC_APP_EMAIL_DOMAIN || "hoops.local";

if (!URL || !SERVICE || URL.includes("placeholder")) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 8 players; each has a "bias" skill per sport so archetypes/balancing have
// something interesting to show. Genders alternate so the gender-balancing
// dimension has real variety to work with.
const PLAYERS = [
  { username: "marcus", name: "Marcus", h: 196, w: 95, gender: "M" as const },
  { username: "deron", name: "Deron", h: 188, w: 84, gender: "M" as const },
  { username: "trey", name: "Trey", h: 190, w: 82, gender: "F" as const },
  { username: "andre", name: "Andre", h: 201, w: 102, gender: "M" as const },
  { username: "jamal", name: "Jamal", h: 185, w: 80, gender: "F" as const },
  { username: "chris", name: "Chris", h: 193, w: 88, gender: "M" as const },
  { username: "luka", name: "Luka", h: 198, w: 99, gender: "F" as const },
  { username: "ty", name: "Ty", h: 183, w: 78, gender: "M" as const },
];
const PASSWORD = "password123";

function randomCode(len = 5): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function biasedScore(sport: SportConfig, paramKey: string, biasIdx: number): number {
  const param = sport.params[biasIdx % sport.params.length];
  const { scaleMin, scaleMax } = sport.params.find((p) => p.key === paramKey)!;
  const mid = Math.round((scaleMin + scaleMax) / 2);
  if (paramKey === param.key) return scaleMax; // this player's standout skill
  const jitter = Math.random() < 0.3 ? 1 : 0;
  return Math.min(scaleMax, mid + jitter);
}

async function seedGroupForSport(sport: SportId, ids: string[]) {
  const config = SPORTS[sport];
  console.log(`\nSeeding ${config.label} group...`);

  const code = randomCode();
  const { data: group, error: gErr } = await admin
    .from("groups")
    .insert({ code, name: `${config.label} Test Group`, sport, creator_id: ids[0] })
    .select("id")
    .single();
  if (gErr || !group) throw new Error(gErr?.message);

  await admin.from("group_players").upsert(
    ids.map((user_id) => ({ group_id: group.id, user_id })),
    { onConflict: "group_id,user_id" },
  );

  // Ratings: everyone rates everyone else, biased toward their own "archetype".
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const values: Record<string, number> = {};
      for (const param of config.params) values[param.key] = biasedScore(config, param.key, j);
      rows.push({ group_id: group.id, rater_id: ids[i], ratee_id: ids[j], values, weight: 1, source: "normal" });
    }
  }
  await admin.from("ratings").upsert(rows, { onConflict: "group_id,rater_id,ratee_id" });
  console.log(`  • ${ids.length} members, ${rows.length} ratings`);

  // Sample gameday: first 6 members playing, 1 guest (rated by the creator),
  // and the 8th member sitting on the waitlist.
  const playing = ids.slice(0, 6);
  const waitlisted = ids[7];

  const { data: gameday, error: gdErr } = await admin
    .from("gamedays")
    .insert({
      group_id: group.id,
      creator_id: ids[0],
      name: "Sample Gameday",
      date: new Date().toISOString().slice(0, 10),
      team_size: 3,
    })
    .select("id")
    .single();
  if (gdErr || !gameday) throw new Error(gdErr?.message);

  await admin
    .from("gameday_participants")
    .insert(playing.map((user_id) => ({ gameday_id: gameday.id, kind: "member", participant_id: user_id })));

  const { data: guest, error: guestErr } = await admin
    .from("gameday_guests")
    .insert({ gameday_id: gameday.id, name: "Drop-in Dana", gender: "F", height_cm: 178, created_by: ids[0] })
    .select("id")
    .single();
  if (guestErr || !guest) throw new Error(guestErr?.message);

  const guestValues: Record<string, number> = {};
  for (const param of config.params) guestValues[param.key] = Math.round((param.scaleMin + param.scaleMax) / 2);
  await admin.from("gameday_guest_ratings").insert({ guest_id: guest.id, rated_by: ids[0], values: guestValues });
  await admin.from("gameday_participants").insert({ gameday_id: gameday.id, kind: "guest", participant_id: guest.id });

  await admin.from("gameday_waitlist").insert({ gameday_id: gameday.id, user_id: waitlisted });

  console.log(`  • sample gameday with ${playing.length} members + 1 guest, 1 on the waitlist`);
  return { code, groupId: group.id };
}

async function main() {
  console.log("Seeding players...");
  const ids: string[] = [];

  for (const p of PLAYERS) {
    const email = `${p.username}@${DOMAIN}`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    let id = created?.user?.id;
    if (error || !id) {
      const { data: list } = await admin.auth.admin.listUsers();
      id = list?.users.find((u) => u.email === email)?.id;
    }
    if (!id) throw new Error(`Could not create/find user ${p.username}`);
    ids.push(id);

    await admin.from("profiles").upsert({
      id,
      username: p.username,
      display_name: p.name,
      gender: p.gender,
      height_cm: p.h,
      weight_kg: p.w,
      photo_url: null,
    });
    console.log(`  • ${p.name} (@${p.username})`);
  }

  const results: { sport: SportId; code: string }[] = [];
  for (const sport of ["basketball", "soccer", "volleyball"] as SportId[]) {
    const { code } = await seedGroupForSport(sport, ids);
    results.push({ sport, code });
  }

  console.log("\n✅ Seed complete!\n");
  console.log("Log in as any of the 8 players, e.g.:");
  console.log(`   username: ${PLAYERS[0].username}`);
  console.log(`   password: ${PASSWORD}`);
  console.log("\nGroup codes:");
  for (const r of results) console.log(`   ${r.sport}: ${r.code}`);
  console.log(`\n(All ${PLAYERS.length} players share the password '${PASSWORD}'.)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
