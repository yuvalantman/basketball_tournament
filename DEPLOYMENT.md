# Deploying Picked Up 🏀⚽🏐

This is a **Next.js + Supabase** app that runs free on **Vercel**. Follow these
steps top to bottom. Total time: ~20 minutes. Nothing here costs money.

---

## 0. Prerequisites

- Node 18+ installed (you have it).
- A **GitHub** account.
- A **Supabase** account (free) — https://supabase.com
- A **Vercel** account (free) — https://vercel.com

---

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Name it (e.g. `hoops`), choose a region near you, set a database password
   (save it somewhere — you won't need it for this app though).
3. Wait ~2 min for it to provision.

### 1a. Get your API keys
In the project: **Settings (gear) → API**. Copy these three values:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key (under "Project API keys", click reveal) → `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ The `service_role` key is a secret. It only ever lives in server env vars,
> never in the browser. Don't commit it.

### 1b. Turn OFF email confirmation
Because usernames map to fake emails, there's no inbox to confirm.
**Authentication → Sign In / Providers → Email** (or **Authentication → Settings**):
- Turn **"Confirm email"** OFF.
- Leave "Enable email provider" ON.
- Save.

### 1c. Run the database schema
1. In Supabase: **SQL Editor → New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql) from this repo, copy the
   **entire** file, paste it into the editor, and click **Run**.
3. It creates all tables, the security rules (RLS), helper functions, and the
   `avatars` storage bucket. You should see "Success. No rows returned."

That's the whole database. The `avatars` bucket for profile photos is created
by the script automatically.

---

## 2. Run it locally (optional but recommended)

```bash
# in the project folder
cp .env.local.example .env.local      # then edit .env.local with your 3 keys
npm install
npm run dev
```

Open http://localhost:3000.

Your `.env.local` should look like:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
NEXT_PUBLIC_APP_EMAIL_DOMAIN=hoops.local
```

### Seed test groups (optional)
With real keys in `.env.local`:

```bash
npm run seed
```

This creates 8 fake players and one group per sport (basketball, soccer,
volleyball), each already full of ratings plus a sample gameday (with a
guest and a waitlisted member). It prints a login and each group's code.
Log in and open **Game days → Sample Gameday → Generate teams** to instantly
see balancing and archetypes. (All seeded players share the password
`password123`.)

You can also verify the core math without any database:

```bash
npm run test:balance
```

---

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "Picked Up pickup sports app"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

> `.env.local` is git-ignored, so your keys are **not** pushed. Good.

---

## 4. Deploy to Vercel

1. Go to https://vercel.com/new and **import** your GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Leave build settings default.
3. Expand **Environment Variables** and add the same six as in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_EMAIL_DOMAIN` (e.g. `hoops.local`)
   - `NEXT_PUBLIC_SITE_URL` — your real Vercel URL, e.g.
     `https://your-app.vercel.app` (used to build the link inside
     password-reset emails)
   - `CRON_SECRET` (any long random string — guards the daily gameday-expiry
     endpoint; Vercel Cron sends it automatically once set)
4. Click **Deploy**. After ~1 min you get a live URL like
   `https://your-app.vercel.app`.

### 4a. Point Supabase at your live URL
In Supabase: **Authentication → URL Configuration**:
- **Site URL**: your Vercel URL.
- **Redirect URLs**: add your Vercel URL **and** `https://your-app.vercel.app/reset-password`
  — Supabase only allows redirecting to URLs on this list, so password-reset
  links will fail silently if `/reset-password` isn't added here.

(Not strictly required for password login, but good hygiene.)

---

## 5. Share it

Send friends the Vercel link. Each person:
1. Opens it on their phone, taps **Create an account** (username, password,
   height, weight, photo).
2. On iPhone Safari / Android Chrome they can **Add to Home Screen** to install
   it like an app — it stays logged in.
3. You create a **group** (pick a sport — basketball, soccer, or volleyball)
   and share the **5-letter code**; they tap **Join by code**.

---

## How the app flows

1. **Create or join a group** — a group is persistent: it never closes, and
   the same group is used forever (or until you delete it).
2. **Rate** — anytime, rate anyone else in the group. Ratings are partial and
   always editable — only the sport's "Overall" field (soccer/volleyball) is
   required, everything else is optional. Always anonymous: nobody, not even
   the group manager, can see who gave what score, only aggregate counts.
3. **Player cards** — shows whatever the group manager has enabled (overall,
   per-attribute averages, radar shape, best/worst skill, archetype), always
   on a 70–100 scale.
4. **Game days** — any member can spin one up: pick a date, a team size, and
   who's coming (group members and/or one-off guests). Generate balanced
   teams (skills, height, gender) with reserves if the numbers don't divide
   evenly. Re-roll, swap, or manually place players; removing someone
   auto-promotes the next person on the waiting list. A gameday auto-deletes
   the day after its date passes (or the creator/manager can delete it
   anytime) — the group and all ratings live on regardless.

---

## Free-tier notes
- Supabase free tier: 500MB database + 1GB file storage — plenty for a friend
  group's photos and data.
- Vercel free (Hobby) tier: more than enough traffic for this.
- No paid AI services are used. The matchup "intro" is a fast local animation.

## Troubleshooting
- **"Invalid login credentials"** on signup → make sure **Confirm email is OFF**
  (step 1b).
- **Photos don't upload** → confirm the `avatars` bucket exists (Storage tab);
  re-run `supabase/schema.sql` if needed.
- **Player cards look empty** → check the group manager's display settings
  (Players tab → Group settings) — numbers only show for whichever toggles
  are enabled, and a player with zero ratings shows nothing either way.
