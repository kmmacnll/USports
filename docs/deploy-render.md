# Deploying to Render

What gets deployed (all defined in [`render.yaml`](../render.yaml)):

| Render resource | Type | What it does |
|---|---|---|
| `varsityhq-db` | PostgreSQL 16 | The database |
| `varsityhq-api` | Web service (Node 22) | The REST API. Each deploy runs migrations and seeds as it starts, and only goes live once they succeed |
| `varsityhq-web` | Web service (Node 22) | The Next.js web app. It calls the API server-side over Render's private network |
| `varsityhq-ingest` | Cron job (Python 3.12), daily 2 AM Eastern | Schedules and box scores for all sports via usportspy |
| `varsityhq-rosters` | Cron job (Python 3.12), weekly | usports.ca roster pages: positions, heights, full rosters |

> **Check before you start:** `render.yaml` was written from Render's
> Blueprint spec as I last knew it (2025). I couldn't reach render.com to
> confirm current field and plan names. Render validates the file in step 2
> and names anything it rejects, most likely a plan name. Change it there,
> or tell me what it says and I'll update the file.

---

> **Region:** every resource in `render.yaml` uses `virginia`. They must all
> be in the **same region as the database**, because its internal hostname
> (`dpg-…-a`) only resolves within that region. A mismatch shows up as
> `getaddrinfo ENOTFOUND dpg-…-a` in the API's deploy log. Neither a service's
> nor a database's region can be changed after creation, so a resource in the
> wrong region has to be deleted and recreated by the Blueprint.

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
   the 5 resources above.
5. Name the Blueprint (e.g. `usports-fantasy`).
6. Render asks for the env vars marked `sync: false` (`JWT_JWKS_URL`,
   `JWT_ISSUER`, `JWT_AUDIENCE`, `MIGRATE_DATABASE_URL`). **Leave them all
   blank for now.** The API uses the generated `JWT_SECRET` until the iOS app
   has real sign-in (step 8).
7. Click **Apply**.

Render then:
- creates the database;
- builds the API (`npm ci --include=dev && npm run build`);
- starts the API with `npm start`. The server opens its port immediately,
  then (because `MIGRATE_ON_START=true`) creates the schema and loads the
  sports, terms and rulesets. It answers `503 starting` until that finishes.
  On a brand-new Blueprint it waits up to 3 minutes for the database to become
  reachable. If it fails, the process exits and the old version keeps running;
- waits for `GET /healthz` to return 200;
- builds the web app (`npm run build` in `web/`) and points it at the API
  through `API_HOSTPORT`;
- builds both cron jobs. They don't run until their schedule, or until you
  trigger them in step 4.

## 3. Check the API

The API's URL is on its dashboard page (e.g. `https://varsityhq-api.onrender.com`).

```bash
curl https://varsityhq-api.onrender.com/healthz
```

```bash
curl https://varsityhq-api.onrender.com/api/v1/sports
```

You should see `usports_fb`, `usports_mbk` and `usports_wbk`, each with its
`ruleset_id`. Athlete search returns an empty list until step 4.

## 4. Load the data (first run)

1. Open **varsityhq-ingest → Trigger Run**.
2. Watch **Logs**. The run takes about a minute and ends with a JSON summary
   for each sport (games, athletes, stat lines).
3. Check the result:

   ```bash
   curl "https://varsityhq-api.onrender.com/api/v1/athletes?sport=usports_mbk&page_size=5"
   ```

From then on the job runs daily at 07:00 UTC, which is 2 AM Eastern in winter (EST) and 3 AM in summer (EDT). Runs with nothing new write nothing.

## 5. First roster scrape: dry run first

The roster scraper is the one part that has never run against live
usports.ca pages. Run it once in dry-run mode, which writes nothing:

1. Open **varsityhq-rosters → Settings → Command**, and add ` --dry-run -v` to the end.
2. Save, then click **Trigger Run**.
3. Read the logs:
   - `Carleton: 15 roster entries (0 new)`-style lines mean it works.
   - `no roster table found for …` or `roster fetch failed for …` means the
     page layout differs from what the parser expects. Send me a few of
     those log lines (and ideally the HTML of one roster page). The parser
     is a small fix once I can see the real markup.
4. If it looks right, remove ` --dry-run -v`, save, and **Trigger Run** for real.

## 5b. Open the web app

Open **varsityhq-web**'s URL (e.g. `https://varsityhq-web.onrender.com`). The
dashboard and player directory work without signing in. To manage a league,
click **Sign in** and paste a token from step 6.

If pages show "Could not reach the API", check that `API_HOSTPORT` on
varsityhq-web has a value (Environment tab) and that varsityhq-api is live.
As a fallback, set `API_BASE_URL` to the API's public URL plus `/api/v1`
and remove `API_HOSTPORT`.

Once the roster job has run, athletes have positions (G/F/C, QB/RB/WR/...) and can fill
starting slots. Until then they can only go on the bench.

> Football rosters need team page links. The football feed doesn't include
> them (basketball's does), so football athletes keep stats-only records
> until that's added.

## 6. Call the API with a test token

User endpoints need a bearer token. Until the app has real sign-in, mint one
from the generated secret:

1. Open **varsityhq-api → Shell** (Shell needs a paid instance).
2. Run:

   ```bash
   cd backend && npm run token -- kieran "Kieran" 30d
   ```

   To use the web app, paste the token at `/login`. The steps below use it
   with `curl` instead.

3. Use the printed token:

   ```bash
   TOKEN=paste-token-here
   API=https://varsityhq-api.onrender.com/api/v1
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

For **Sign in with Apple**, set these on **varsityhq-api → Environment**:

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
  `backend/` or `db/` changes deploy the API, `web/` changes deploy the web
  app, and `pipeline/` changes rebuild the crons.
- **Rollback:** **varsityhq-api → Events / Deploys → Rollback**. This rolls back
  code, not the database. Migrations only move forward, so write them to be
  backwards compatible: add columns before the code that uses them, and
  remove them after.
- **Schema changes:** add a new numbered file, e.g.
  `db/migrations/0002_add_x.up.sql` with a matching `.down.sql`. Never edit
  `0001` once it has been deployed. The API applies new files automatically
  when it starts.
- **Rulesets:** edit `db/seeds/0003_default_competitions.sql`. The next
  deploy updates the current season's rules. Past seasons keep theirs.
- **New season:** nothing to do. On July 1 the season label rolls over, and
  the next deploy and pipeline run create next season's rulesets and games.
  Deploy something (or **Manual Deploy**) after July 1 so the seeds run.
- **Database access from your laptop:** add your IP under **varsityhq-db →
  Networking / Access Control** (`ipAllowList` is empty by default, so nothing
  outside Render can connect). Then use the **External Database URL**, which
  requires SSL.
- **Logs:** each resource's **Logs** tab. The API logs JSON (pino).

## Costs and plans

All five resources are on paid plans, because:
- cron jobs have no free tier;
- free web services sleep when idle, so the first request after a pause is slow;
- free databases expire.

Expect roughly the price of two starter web services, plus a small Postgres,
plus a few cents of cron runtime per month. Check current pricing at
<https://render.com/pricing>; I couldn't verify it from here.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build: `tsc: not found` | The build must use `npm ci --include=dev`, because `NODE_ENV=production` skips dev dependencies |
| Service settings don't change after editing `render.yaml` (e.g. the log still shows an old start command) | The Blueprint sync is failing, so nothing in `render.yaml` is applied, and `DATABASE_URL` can stay stale. Open the Blueprint and read the last sync's error. A common cause is declaring a field that can't change on an existing database (`databaseName`, `user`, `postgresMajorVersion`); `render.yaml` deliberately doesn't set them |
| `ENOTFOUND dpg-…-a` while everything is in one region | Compare the host in varsityhq-api's `DATABASE_URL` with the host in varsityhq-db's **Internal Database URL**. If they differ, `DATABASE_URL` is stale: fix the Blueprint sync (row above), or paste the current Internal Database URL into `DATABASE_URL` |
| API deploy log: `Error: getaddrinfo ENOTFOUND dpg-…-a` | The database's internal hostname doesn't resolve. (1) Check that **varsityhq-db** and **varsityhq-api** are in the same region: internal hostnames only resolve within one region. A service can't change region, so delete it and re-sync the Blueprint to recreate it in the database's region (`virginia` in render.yaml). (2) Or set `MIGRATE_DATABASE_URL` on varsityhq-api to the database's **External Database URL** plus `?sslmode=require`. That only fixes migrations, though; the running API also uses the internal URL, so a region mismatch still has to be fixed |
| Web service fails right after the API fails | varsityhq-web gets `API_HOSTPORT` from varsityhq-api. Fix the API first, then **Manual Deploy** the web service |
| Migration step fails | The deploy log shows the SQL error. The previous version keeps serving |
| `No open ports detected … Exited with status 1` | The process stopped before listening. The real error is a few lines **above** this message, e.g. `✗ startup aborted: Invalid environment …` (a malformed env var; blank values are fine) or a migration error |
| API won't start: `Configure JWT_SECRET or JWT_JWKS_URL` | Set one of them on varsityhq-api → Environment |
| Cron: `Failed to retrieve release data: 403` | The run is missing `--no-season-check`. usportspy's season lookup hits the GitHub API, which is rate-limited per IP, and Render IPs are shared |
| Roster job: many `roster fetch failed … 429` | usports.ca is rate-limiting. The scraper already waits 1 s between requests; raise `REQUEST_INTERVAL_S` in `pipeline/usports_pipeline/rosters.py` |
| `/athletes` is empty | Run step 4 (Trigger Run on varsityhq-ingest) |
