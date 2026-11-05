# Deploying to Render

What gets deployed (all defined in [`render.yaml`](../render.yaml)):

| Render resource | Type | What it does |
|---|---|---|
| `usports-db` | PostgreSQL 16 | The database |
| `usports-api` | Web service (Node 22) | The REST API. Each deploy runs migrations and seeds before going live |
| `usports-ingest-stats` | Cron job (Python 3.12), every 2 h | Schedules and box scores for all sports via usportspy |
| `usports-ingest-rosters` | Cron job (Python 3.12), weekly | usports.ca roster pages: positions, heights, full rosters |

> **Check before you start:** `render.yaml` was written from Render's
> Blueprint spec as I last knew it (2025). I couldn't reach render.com to
> confirm current field and plan names. Render validates the file in step 2
> and names anything it rejects, most likely a plan name. Change it there,
> or tell me what it says and I'll update the file.

---

## 1. Put the code on `main`

The Blueprint deploys from `main` (`branch: main` in `render.yaml`). Merge the
`claude/dazzling-heisenberg-aulfbz` branch into `main` with a pull request.
To deploy a different branch instead, change every `branch:` line in
`render.yaml`.

## 2. Create the Blueprint

1. Sign in at <https://dashboard.render.com>.
2. Click **New → Blueprint**.
3. Connect GitHub if prompted, and give Render access to the `kmmacnll/USports` repository.
4. Select the repository. Render finds `render.yaml` at the root and lists
   the 4 resources above.
5. Name the Blueprint (e.g. `usports-fantasy`).
6. Render asks for the env vars marked `sync: false` (`JWT_JWKS_URL`,
   `JWT_ISSUER`, `JWT_AUDIENCE`). **Leave all three blank for now.** The API
   uses the generated `JWT_SECRET` until the iOS app has real sign-in (step 7).
7. Click **Apply**.

Render then:
- creates the database;
- builds the API (`npm ci --include=dev && npm run build`);
- runs the **pre-deploy** step (`npm run migrate`), which creates the schema
  and loads the sports, terms and rulesets. If this step fails, the old
  version keeps running and nothing goes live;
- starts the API and waits for `GET /healthz` to return 200;
- builds both cron jobs. They don't run until their schedule, or until you
  trigger them in step 4.

## 3. Check the API

The API's URL is on its dashboard page (e.g. `https://usports-api.onrender.com`).

```bash
curl https://usports-api.onrender.com/healthz
```

```bash
curl https://usports-api.onrender.com/api/v1/sports
```

You should see `usports_fb`, `usports_mbk` and `usports_wbk`, each with its
`ruleset_id`. Athlete search returns an empty list until step 4.

## 4. Load the data (first run)

1. Open **usports-ingest-stats → Trigger Run**.
2. Watch **Logs**. The run takes about a minute and ends with a JSON summary
   for each sport (games, athletes, stat lines).
3. Check the result:

   ```bash
   curl "https://usports-api.onrender.com/api/v1/athletes?sport=usports_mbk&page_size=5"
   ```

From then on the job runs every 2 hours. Runs with nothing new write nothing.

## 5. First roster scrape: dry run first

The roster scraper is the one part that has never run against live
usports.ca pages. Run it once in dry-run mode, which writes nothing:

1. Open **usports-ingest-rosters → Settings → Command**, and add ` --dry-run -v` to the end.
2. Save, then click **Trigger Run**.
3. Read the logs:
   - `Carleton: 15 roster entries (0 new)`-style lines mean it works.
   - `no roster table found for …` or `roster fetch failed for …` means the
     page layout differs from what the parser expects. Send me a few of
     those log lines (and ideally the HTML of one roster page). The parser
     is a small fix once I can see the real markup.
4. If it looks right, remove ` --dry-run -v`, save, and **Trigger Run** for real.

Once it has run, athletes have positions (G/F/C, QB/RB/WR/...) and can fill
starting slots. Until then they can only go on the bench.

> Football rosters need team page links. The football feed doesn't include
> them (basketball's does), so football athletes keep stats-only records
> until that's added.

## 6. Call the API with a test token

User endpoints need a bearer token. Until the app has real sign-in, mint one
from the generated secret:

1. Open **usports-api → Shell** (Shell needs a paid instance).
2. Run:

   ```bash
   cd backend && npm run token -- kieran "Kieran" 30d
   ```

3. Use the printed token:

   ```bash
   TOKEN=paste-token-here
   API=https://usports-api.onrender.com/api/v1
   ```

   ```bash
   curl -X PUT $API/me/terms -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"terms_version":"2026-11-01","is_usports_athlete":false}'
   ```

   ```bash
   curl -X POST $API/leagues -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"league_name":"Test League","sport":"usports_mbk","team_name":"My Five"}'
   ```

Anyone with `JWT_SECRET` can mint tokens for any user. Keep it secret, and
rotate it (**Environment → JWT_SECRET → Generate**) once real sign-in is live.

## 7. Switch to real sign-in (when the iOS app exists)

For **Sign in with Apple**, set these on **usports-api → Environment**:

| Key | Value |
|---|---|
| `JWT_JWKS_URL` | `https://appleid.apple.com/auth/keys` |
| `JWT_ISSUER` | `https://appleid.apple.com` |
| `JWT_AUDIENCE` | your app's bundle ID, e.g. `ca.yourname.usportsfantasy` |

Once `JWT_JWKS_URL` is set, the API accepts only provider tokens; the
`JWT_SECRET` path is no longer used. The app sends Apple's identity token as
`Authorization: Bearer …`. Other providers (Auth0, Supabase, Firebase) work
the same way with their own JWKS URL, issuer and audience.

## 8. Day-to-day

- **Deploys:** pushing to `main` redeploys only what changed (`buildFilter`):
  API changes deploy the API, and pipeline changes rebuild the crons.
- **Rollback:** **usports-api → Events / Deploys → Rollback**. This rolls back
  code, not the database. Migrations only move forward, so write them to be
  backwards compatible: add columns before the code that uses them, and
  remove them after.
- **Schema changes:** add a new numbered file, e.g.
  `db/migrations/0002_add_x.up.sql` with a matching `.down.sql`. Never edit
  `0001` once it has been deployed. The pre-deploy step applies new files
  automatically.
- **Rulesets:** edit `db/seeds/0003_default_competitions.sql`. The next
  deploy updates the current season's rules. Past seasons keep theirs.
- **New season:** nothing to do. On July 1 the season label rolls over, and
  the next deploy and pipeline run create next season's rulesets and games.
  Deploy something (or **Manual Deploy**) after July 1 so the seeds run.
- **Database access from your laptop:** add your IP under **usports-db →
  Networking / Access Control** (`ipAllowList` is empty by default, so nothing
  outside Render can connect). Then use the **External Database URL**, which
  requires SSL.
- **Logs:** each resource's **Logs** tab. The API logs JSON (pino).

## Costs and plans

All four resources are on paid plans, because:
- cron jobs have no free tier;
- the pre-deploy migration step needs a paid web instance;
- free databases expire.

Expect roughly the price of a starter web service, plus a small Postgres,
plus a few cents of cron runtime per month. Check current pricing at
<https://render.com/pricing>; I couldn't verify it from here.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build: `tsc: not found` | The build must use `npm ci --include=dev`, because `NODE_ENV=production` skips dev dependencies |
| Pre-deploy fails | Open the deploy's logs. The SQL error is printed, and the previous version keeps serving |
| API won't start: `Configure JWT_SECRET or JWT_JWKS_URL` | Set one of them on usports-api → Environment |
| Cron: `Failed to retrieve release data: 403` | The run is missing `--no-season-check`. usportspy's season lookup hits the GitHub API, which is rate-limited per IP, and Render IPs are shared |
| Roster job: many `roster fetch failed … 429` | usports.ca is rate-limiting. The scraper already waits 1 s between requests; raise `REQUEST_INTERVAL_S` in `pipeline/usports_pipeline/rosters.py` |
| `/athletes` is empty | Run step 4 (Trigger Run on usports-ingest-stats) |
