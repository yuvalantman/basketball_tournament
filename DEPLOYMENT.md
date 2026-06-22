# Deploying Hoops 🏀

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

### Seed a test tournament (optional)
With real keys in `.env.local`:

```bash
npm run seed
```

This creates 8 fake players + a tournament already full of ratings, and prints
a creator login + a tournament code. Log in as that user and click
**"Close & build teams"** to instantly see balancing, archetypes, and the
bracket. (All seeded players share the password `password123`.)

You can also verify the core math without any database:

```bash
npm run test:balance
```

---

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "Hoops tournament app"
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
3. Expand **Environment Variables** and add the same four as in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_EMAIL_DOMAIN` (e.g. `hoops.local`)
4. Click **Deploy**. After ~1 min you get a live URL like
   `https://your-app.vercel.app`.

### 4a. Point Supabase at your live URL
In Supabase: **Authentication → URL Configuration**:
- **Site URL**: your Vercel URL.
- **Redirect URLs**: add your Vercel URL.

(Not strictly required for password login, but good hygiene.)

---

## 5. Share it

Send friends the Vercel link. Each person:
1. Opens it on their phone, taps **Create an account** (username, password,
   height, weight, photo).
2. On iPhone Safari / Android Chrome they can **Add to Home Screen** to install
   it like an app — it stays logged in.
3. You create a tournament and share the **5-letter code**; they tap
   **Join by code**.

---

## How the app flows (creator's controls are the bottom bar)

1. **Lobby** — everyone joins by code; you can mark "keep apart" pairs.
2. **Start rating** — everyone anonymously rates everyone else.
   Tap **"Who's done?"** to see who's finished (you can't see *how* anyone
   rated — that's always anonymous).
3. **Close & build teams** — computes averages, archetypes, and balanced teams
   (even across every skill + height, honoring your restrictions). Re-roll or
   swap players if you like.
4. **Lock teams & start games** — builds the schedule:
   - 4 teams → semfinals → final (+ 3rd place).
   - 5+ teams → each plays 2 group games to 11; top 4 by record advance to a
     random bracket.
5. **Enter scores** — the bracket auto-advances. Tap **▶ Intro** on any game
   for the animated VS matchup card.

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
- **Stats look empty** → stats only appear after you click "Close & build teams".
