# `backend/` — REST API

Node 22, Express 5, TypeScript, `pg` with raw SQL (no ORM), and zod for request
validation. It reads the schema in `db/` and the data written by `pipeline/`.

```bash
cd backend
npm ci
cp .env.example .env          # AUTH_DEV_HEADER=true for local use
npm run dev                   # http://localhost:3000
npm test                      # builds a throwaway `usports_api_test` DB from db/ migrations + fixtures
npm run build && npm start    # compiled
npm run migrate:dev           # apply db/ migrations + seeds without psql (Render runs `npm run migrate` at start)
JWT_SECRET=... npm run token -- <subject> [name] [ttl]   # mint a test bearer token (after build)
```

Deploying: see [`docs/deploy-render.md`](../docs/deploy-render.md).

Tests need a Postgres role that can create databases. `TEST_DATABASE_URL`
defaults to `postgres://usports:usports@localhost:5432/usports_api_test`.
For safety, the test database name must contain "test".

## Endpoints (`/api/v1`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/sports` | – | Active sports with `season_type`, default `ruleset_id`, roster slots, position eligibility, scoring and stat columns. `?sport_id=usports_mhk` returns one sport (inactive ones included). Also `?season_type=FALL\|WINTER\|SPRING` and `?include_inactive=true` |
| GET | `/athletes?sport_id=usports_mhk` | – | Search athletes with season stats. Filters: `university` (slug or id), `q` (name prefix), `position` (matches the slot's eligibility, e.g. hockey `F` = C/LW/RW), `conference`, `season`. Also `sort=fantasy_points\|name`, `page`, `page_size` (≤100). `sport` is accepted as an alias for `sport_id` |
| POST | `/auth/signup` | – | `{ name, email, password, password_confirmation, university? }` → creates the account. `name` (2-40 chars) is the display name; `university` is an optional slug from `/universities` (password hashed with scrypt in `users.password_hash`) and returns a 30-day bearer token. Passwords are 8-128 characters. 409 `EMAIL_TAKEN` if the email exists |
| POST | `/auth/login` | – | `{ email, password }` → a 30-day bearer token. Failed attempts are rate limited (10 per address per 15 min). Both need `JWT_SECRET` |
| GET | `/me` | ✓ | Profile (incl. `university`), terms status, declared athlete sports, teams |
| PUT | `/me/terms` | ✓ | Accept the current T&C and answer the U Sports athlete question |
| POST | `/leagues` | ✓ | Create a league. Optional `ruleset_id` (defaults to the sport's default ruleset), `roster_limits` and `roster_size`. Optional `team_name` also creates the commissioner's team |
| GET | `/leagues/:id` | ✓ | League details (private leagues: members only) |
| POST | `/leagues/:id/teams` | ✓ | Join with `team_name`. Private leagues also need `invite_code` |
| GET | `/leagues/:id/roster` | ✓ | Your roster, or `?team_id=tm_…` for another team in the league. Lists every slot, including empty ones |
| POST | `/leagues/:id/roster` | ✓ | Add an athlete. With no `slot`, uses the first eligible open starter slot, then the bench |
| DELETE | `/leagues/:id/roster/:athleteId` | ✓ | Drop an athlete |
| POST | `/leagues/:id/roster/swap` | ✓ | Move an athlete to `target_slot` (and `target_slot_index`). If the slot is filled, the two athletes trade places atomically |
| GET | `/healthz` | – | Liveness + DB check |

IDs are prefixed: `usports_ath_<n>`, `lg_<n>`, `tm_<n>`, `usr_<n>`; sports use their code (`usports_mbk`).

### Examples

```http
POST /api/v1/leagues
{ "league_name": "Vanier Cup Chasers", "sport": "usports_fb", "max_teams": 10,
  "roster_size": 15, "roster_limits": { "QB": 2, "RB": 3, "WR": 4, "K": 1, "DEF": 1, "BENCH": 4 },
  "ruleset_id": "usports_football_half_ppr", "team_name": "Commish FC" }
→ 201 { "league_id": "lg_12", "league_name": "Vanier Cup Chasers", "commissioner_id": "usr_1",
        "max_teams": 10, "sport": "usports_fb", "roster_size": 15, "roster_limits": {...},
        "ruleset_id": "usports_football_half_ppr", "ruleset_name": "Half-PPR Scoring",
        "scoring_rules": { "passing": { "yards": 0.04, ... }, ... }, "season": "2026-27",
        "invite_code": "3f9a1c2e", ... }

GET /api/v1/athletes?sport_id=usports_mbk&university=carleton
→ 200 { "season": "2026-27",
        "data": [{ "athlete_id": "usports_ath_15", "first_name": "...", "last_name": "...",
                   "university": "Carleton", "conference": null, "sport": "usports_mbk", "position": "G",
                   "positions": ["G"],
                   "stats": { "games_played": 4, "ppg": 16.5, "rpg": 8, "apg": 0.8, ...,
                              "fantasy_points_avg": 31.98 } }],
        "pagination": { "page": 1, "page_size": 25, "total": 14 } }

POST /api/v1/leagues/lg_12/roster/swap
{ "athlete_id": "usports_ath_15", "target_slot": "BENCH" }
→ 200 { "team": {...}, "roster_size": 11, "filled": 11,
        "slots": [{ "slot": "G", "slot_index": 1, "slot_type": "STARTER", "athlete": {...} }, ...] }
```

Season stats leave out exhibition games. Basketball summaries are `ppg`, `rpg`, `apg`, `spg`, `bpg`, `tpg` and `mpg`. Football summaries are `pass_ypg`, `pass_tdpg`, `rush_ypg`, `rush_tdpg`, `rec_pg`, `rec_ypg`, `rec_tdpg`, `fgm_pg`, `tackles_pg` and `sacks_pg`. `season_fantasy_points` on a roster
uses the league's own competition scoring.

## Errors

Every error is returned as `{ "error": { "code", "message", "details?" } }`.

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_ID`, `NO_CHANGE` |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN` |
| 403 | `TERMS_NOT_ACCEPTED`, `ATHLETE_OWN_SPORT` |
| 404 | `NOT_FOUND`, `NO_TEAM`, `NOT_ON_ROSTER`, `UNKNOWN_SPORT`, `ROUTE_NOT_FOUND` |
| 409 | `LEAGUE_FULL`, `ALREADY_IN_LEAGUE`, `TEAM_NAME_TAKEN`, `ATHLETE_ALREADY_ROSTERED`, `SLOT_OCCUPIED`, `ROSTER_FULL`, `TERMS_VERSION_MISMATCH`, `ATHLETE_DECLARATION_LOCKED` |
| 422 | `INVALID_SLOT`, `INELIGIBLE_POSITION`, `WRONG_SPORT`, `ROSTER_SIZE_MISMATCH`, `SPORT_INACTIVE`, `NO_RULESET`, `UNKNOWN_RULESET`, `ATHLETE_SPORTS_REQUIRED`, `CONSTRAINT_VIOLATION` |

Most business rules live in the database (see `db/README.md`). The database
raises them with a stable `HINT`, and `src/errors.ts` maps that hint to these
codes. The API cannot bypass a rule.

## Auth

The API has no login of its own. It verifies a bearer JWT from whichever
identity provider the app adopts, and `sub` becomes `users.auth_subject`. A
`users` row is created on first request.

- `JWT_JWKS_URL` (+ `JWT_ISSUER` / `JWT_AUDIENCE`): RS256/ES256 providers such as Sign in with Apple, Auth0 or Supabase.
- `JWT_SECRET`: HS256 shared secret.
- `AUTH_DEV_HEADER=true`: trusts `X-Dev-User: <subject>`, for local work only. Startup fails if it is set with `NODE_ENV=production`.

## Layout

```
src/
  index.ts          server bootstrap + graceful shutdown
  migrate.ts        migration + seed runner (runs before the server on Render)
  mint-token.ts     test-token CLI
  app.ts            express app (createApp is used by tests too)
  config.ts         env validation
  auth.ts           JWT / dev-header auth, user provisioning
  db.ts             pg pool + withTransaction
  errors.ts         HttpError, Postgres error → API error mapping
  ids.ts            public id encode/decode
  sport-display.ts  stat summaries (ppg/rpg…), slot ordering, eligibility
  routes/index.ts   routers + zod request schemas
  services/         sports, athletes, leagues/rosters, me (all SQL lives here)
test/               vitest + supertest against a real Postgres
```

## Not built yet
- Draft, waivers, trades, and lineup locks at game time (swaps are currently allowed at any time).
- Weekly matchups and standings.
- Rate limiting. Put the API behind a gateway, or add `express-rate-limit`, before going public.
- `athlete_season_stats` is a plain view, which is fast enough at current volume (~100 ms per search). Switch it to a materialised view refreshed by the pipeline when the data grows.
