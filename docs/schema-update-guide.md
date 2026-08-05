# Updating your Supabase project to the multi-sport groups schema

This walks through moving your **live** Supabase project (the one with your
real ~18-user basketball tournament, currently paused) from the old
"tournament" schema to the new "groups + gamedays" schema — safely, with a
backup, so you never risk that data.

Read the whole thing once before running anything. Total time: ~15 minutes.

**Two things you don't need for this:**
- **The Supabase CLI / "Migrations" tab workflow** (`supabase link`,
  `supabase migration new`, `supabase db push`) is Supabase's *own* migration
  tracking system — a different, more involved way of applying schema
  changes that requires installing the CLI locally and linking the project.
  This guide uses the simpler path (paste the SQL directly into the SQL
  Editor and run it), which works exactly the same for a one-time migration
  like this. Ignore the CLI tab entirely unless you specifically want
  ongoing migration tracking going forward.
- **The GitHub/Vercel integration** in Supabase's Integrations tab (syncing
  env vars / preview deployments) has no effect on this migration — it's
  unrelated to running SQL in the editor. Whether or not that integration
  succeeded doesn't change anything below.

---

## 0. What's about to happen

- `supabase/migrations/0002_to_groups_multisport.sql` is a **single
  transactional script** — it either fully applies or fully rolls back, it
  can't leave your database half-migrated.
- It **renames** your existing `tournaments` table to `groups` (same rows,
  same ids) and `tournament_players` to `group_players` — your roster
  survives untouched.
- It **reshapes** your existing `ratings` rows from 8 separate number columns
  into the new sparse format — every rating anyone gave is preserved with the
  same values, just stored differently.
- It **creates** the new empty tables gamedays need (`gamedays`,
  `gameday_guests`, `gameday_participants`, `gameday_waitlist`,
  `gameday_restrictions`) — there's nothing to migrate into these since your
  live tournament never reached team generation.
- It **drops** the old `teams`, `team_members`, `games`, and `restrictions`
  tables — safe, because nothing was ever generated on the live tournament
  (it's still mid-rating). If you've since generated teams/a bracket on the
  live project, stop and re-read the note in step 2 before proceeding.

---

## 1. Bring the paused Supabase project back up

1. Go to https://supabase.com/dashboard and open the project.
2. If it shows as paused/inactive, click **Restore project** (free-tier
   projects pause after a week of inactivity — restoring is free and takes
   a couple of minutes).
3. Wait until the project status shows **Active** before continuing.

---

## 2. Back it up first (free-tier friendly)

The migration is transactional — if any statement errors, Postgres rolls back
everything in it, so a failed run can't leave your data half-migrated (this
already happened once and confirmed it: the run below hit a bug, errored out,
and your original data was untouched). A backup is still worth having as a
safety net for anything *outside* that — e.g. deciding afterward you don't
like the result, or wanting to compare before/after.

**Project duplication requires a paid plan** — skip it. On the free tier,
this is enough for a roster + ratings table this size:

1. In Supabase: **SQL Editor → New query**.
2. Run each of these one at a time, and click the **Download CSV** button
   above the results panel after each:
   ```sql
   select * from public.tournaments;
   select * from public.tournament_players;
   select * from public.ratings;
   ```
3. Save the three CSVs somewhere (a folder on your computer is fine). That's
   your restore point — if you ever needed to rebuild the old data by hand,
   it's all there.

> **Stop and re-check first if you've generated teams/a bracket since this
> plan was written.** This migration assumes the live tournament is still
> mid-rating with no teams generated (that was true when this was planned).
> If that's changed, the migration will still run, but it drops the old
> `teams`/`team_members`/`games` tables — any generated teams/bracket will be
> lost (ratings are NOT affected either way). If you want that team data
> preserved, come back with the current details on Claude Code and it can
> add a migration step for it before you run anything.

---

## 3. Run the migration

1. In Supabase: **SQL Editor → New query**.
2. Open [`supabase/migrations/0002_to_groups_multisport.sql`](../supabase/migrations/0002_to_groups_multisport.sql)
   from this repo, copy the **entire** file, paste it into the editor.
3. Click **Run**.
4. You should see **Success. No rows returned.** If you instead see an
   error, nothing was changed (it's one transaction) — copy the exact error
   message and get help before retrying.

---

## 4. Verify the migration

Still in the SQL Editor, run each of these and sanity-check the numbers
against what you expect (they're also printed as comments at the bottom of
the migration file itself):

```sql
select count(*) from public.groups;          -- should be 1 (your live group)
select count(*) from public.group_players;   -- should match your old roster count
select count(*) from public.ratings;         -- should match your old rating count
select id, values, weight, source from public.ratings limit 5; -- spot-check the reshape
```

For that last query, each row's `values` should be a JSON object like
`{"shooting": 4, "passing": 3, ...}` matching whatever that rater actually
submitted — `weight` should be `1` and `source` should be `'normal'` for
every row (all pre-existing ratings were normal self-ratings).

Also confirm the new empty tables exist and the old ones are gone:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
```

You should see `gamedays`, `gameday_guests`, `gameday_guest_ratings`,
`gameday_participants`, `gameday_waitlist`, `gameday_restrictions`, `groups`,
`group_players`, `profiles`, `ratings`, `team_members`, `teams` — and you
should **not** see `tournaments`, `tournament_players`, `restrictions`, or
`games` anymore.

---

## 5. Deploy the new app build

The old app build's queries reference tables/columns this migration removes,
so there's a brief cutover window — do this step right after step 3–4
succeed, not before.

1. Push this code to your GitHub repo (see [`DEPLOYMENT.md`](../DEPLOYMENT.md)
   if you haven't already connected it to Vercel).
2. In Vercel, make sure the environment variables are still correct — nothing
   about the Supabase URL/keys changes, but if you duplicated the project in
   step 2 and are cutting over to the duplicate permanently, update
   `NEXT_PUBLIC_SUPABASE_URL` / the keys to point at it.
3. Add one new environment variable: **`CRON_SECRET`** — any long random
   string (e.g. generate one with `openssl rand -hex 32` or a password
   manager). This guards the daily gameday-expiry endpoint
   (`/api/cron/expire-gamedays`) so only Vercel's own Cron scheduler can
   trigger it. Vercel Cron sends this automatically once it's set — you
   don't need to configure anything else, `vercel.json` already declares the
   daily schedule.
4. Deploy (or let Vercel's auto-deploy on push pick it up).
5. Open the live URL, log in as one of your existing users, and open the
   migrated group — confirm the roster and everyone's ratings are there, and
   that rating (with the new partial/editable behavior) works.

---

## 6. If something looks wrong

- **Migration errored and rolled back**: nothing was changed — your project
  is exactly as it was before you ran it. Fix the reported issue (or ask for
  help with the exact error) and try again.
- **Migration succeeded but the app shows no data**: double-check the app is
  actually pointed at this Supabase project (`NEXT_PUBLIC_SUPABASE_URL` in
  Vercel's environment variables) and that you deployed the new build (not
  an old cached one).
- **You want to undo everything**: restore your Settings → Database →
  Backups snapshot from before the migration, or switch the app back to the
  untouched duplicate project from step 2 if you made one.
