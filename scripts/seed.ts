// Seed a ready-to-play tournament with fake players + ratings so you can walk
// the whole flow immediately. Requires a real Supabase project + the keys in
// .env.local (incl. SUPABASE_SERVICE_ROLE_KEY).
//
//   npm run seed
//
// Prints a creator login + tournament code at the end.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { RATING_PARAMS } from "../lib/constants";

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
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PLAYERS = [
  { username: "marcus", name: "Marcus", h: 196, w: 95, bias: "rebounding" },
  { username: "deron", name: "Deron", h: 188, w: 84, bias: "passing" },
  { username: "trey", name: "Trey", h: 190, w: 82, bias: "shooting" },
  { username: "andre", name: "Andre", h: 201, w: 102, bias: "physicality" },
  { username: "jamal", name: "Jamal", h: 185, w: 80, bias: "dribbling" },
  { username: "chris", name: "Chris", h: 193, w: 88, bias: "defending" },
  { username: "luka", name: "Luka", h: 198, w: 99, bias: "scoring" },
  { username: "ty", name: "Ty", h: 183, w: 78, bias: "athleticism" },
];
const PASSWORD = "password123";

function biasedScore(param: string, bias: string): number {
  const base = 2 + Math.floor(Math.random() * 2); // 2-3
  if (param === bias) return 5;
  return Math.min(5, base + (Math.random() < 0.3 ? 1 : 0));
}

async function main() {
  console.log("Seeding players...");
  const ids: string[] = [];

  for (const p of PLAYERS) {
    const email = `${p.username}@${DOMAIN}`;
    // Create (or fetch existing) auth user.
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    let id = created?.user?.id;
    if (error || !id) {
      // Likely already exists — find them.
      const { data: list } = await admin.auth.admin.listUsers();
      id = list?.users.find((u) => u.email === email)?.id;
    }
    if (!id) throw new Error(`Could not create/find user ${p.username}`);
    ids.push(id);

    await admin.from("profiles").upsert({
      id,
      username: p.username,
      display_name: p.name,
      height_cm: p.h,
      weight_kg: p.w,
      photo_url: null,
    });
    console.log(`  • ${p.name} (@${p.username})`);
  }

  const creatorId = ids[0];

  // Create tournament.
  const code = Math.random().toString(36).slice(2, 7).toUpperCase();
  const { data: tournament, error: tErr } = await admin
    .from("tournaments")
    .insert({
      code,
      name: "Seeded Showdown",
      creator_id: creatorId,
      rating_mode: "eight",
      stats_visibility: "creator_only",
      team_size: 2,
      status: "rating",
    })
    .select("id")
    .single();
  if (tErr || !tournament) throw new Error(tErr?.message);
  const tid = tournament.id;

  // Memberships.
  await admin.from("tournament_players").upsert(
    ids.map((user_id) => ({ tournament_id: tid, user_id })),
    { onConflict: "tournament_id,user_id" },
  );

  // Ratings: everyone rates everyone else (biased toward their archetype).
  console.log("Seeding ratings...");
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    for (let j = 0; j < PLAYERS.length; j++) {
      if (i === j) continue;
      const row: Record<string, unknown> = {
        tournament_id: tid,
        rater_id: ids[i],
        ratee_id: ids[j],
      };
      for (const param of RATING_PARAMS)
        row[param] = biasedScore(param, PLAYERS[j].bias);
      rows.push(row);
    }
  }
  await admin
    .from("ratings")
    .upsert(rows, { onConflict: "tournament_id,rater_id,ratee_id" });

  console.log("\n✅ Seed complete!\n");
  console.log("Log in as the creator:");
  console.log(`   username: ${PLAYERS[0].username}`);
  console.log(`   password: ${PASSWORD}`);
  console.log(`Tournament code: ${code}`);
  console.log(
    "\nIt's in the 'rating' phase with all ratings in — log in and hit",
  );
  console.log("'Close & build teams' to see balancing, archetypes & bracket.");
  console.log(
    `(All ${PLAYERS.length} players share the password '${PASSWORD}'.)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
