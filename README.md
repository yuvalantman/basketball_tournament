# Hoops 🏀 — Tournament Builder

A mobile-first web app for running a basketball tournament with your friends.
Players sign up, peer-rate each other, get balanced teams + an NBA2K-style
archetype, and play through an auto-generated bracket.

**→ To get it online, follow [DEPLOYMENT.md](DEPLOYMENT.md).**

## Features
- **Username + password** auth that stays logged in on your device (installable
  as a phone app / PWA).
- Profiles with photo, height, weight.
- **Create / join tournaments** by 5-letter code.
- **Anonymous peer ratings** — 8 skills (1–5) or a single overall (1–10).
  No one (not even the creator) can see who rated whom or how. The creator can
  only see *who has finished* rating.
- **Configurable stats visibility** after rating: creator-only numbers /
  everyone sees averages / radar shapes with no numbers.
- **NBA2K-style archetypes** (Sharpshooter, Lockdown Defender, Glass Cleaner…).
- **Multi-dimensional team balancing** — even across every skill *and* height,
  not just total strength, honoring "keep these two apart" restrictions.
  Re-roll or hand-swap.
- **Auto brackets**: 4 teams → semis/final; 5+ teams → full round-robin group
  stage (everyone plays everyone, scheduled into matchdays) → top 4 by record →
  random bracket. Auto-advancing as scores are entered.
- **Animated VS matchup cards** for each game.

## Tech
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · Framer Motion ·
Supabase (Postgres + Auth + Storage) · deployed on Vercel. All free tier.

## Scripts
```bash
npm run dev           # local dev
npm run build         # production build
npm run seed          # seed fake players + ratings (needs real Supabase keys)
npm run test:balance  # offline test of balancing/bracket/archetype logic
```

## Where things live
- `lib/balancing.ts` — multi-dimensional balancer + restriction constraints.
- `lib/archetype.ts` — archetype + best/worst skill derivation.
- `lib/bracket.ts` — schedule/standings/bracket logic.
- `lib/stats.ts` — anonymous-rating aggregation + visibility filtering.
- `app/actions/*` — server actions (privileged work runs with the service role;
  raw ratings never reach the client).
- `supabase/schema.sql` — full database, RLS, and storage setup.
