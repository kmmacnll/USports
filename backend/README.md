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

## Draft Battles

A fast 1v1 mode: two users snake-draft a lineup from one sport, then the
server simulates a match from the players' ratings and streams it to both
users as a live play-by-play. All code is in `src/battles/`.

| File | What |
|---|---|
| `sports/<sport>.ts` | **one config per sport**: lineup, positions + inference, rating metrics, sub-ratings, OVR weights, shrinkage k, sim tuning, timing |
| `config.ts` | settings that aren't sport-specific (recency weights, calibration curve, pick timer, invite TTLs, queue widening, Elo K, ladder sizes) |
| `ratings/` | OVR + sub-ratings: pure maths (`compute.ts`), DB job (`job.ts`), CLIs |
| `sim/` | `simulate(sport, lineupA, lineupB, seed)`: one deterministic engine per sport; `calibrate.ts` Monte Carlo harness |
| `draft.ts` | snake order, slot eligibility, best available (pure) |
| `service.ts` | battle lifecycle, picks, auto-picks, running and streaming matches, `tick()` |
| `matchmaking.ts` | friend invites, notifications, ranked queue |
| `ladder.ts` | Elo, weekly division cohorts, weekly reset, `/ladder/me`, `/me/stats` |
| `realtime.ts` | WebSocket hub (`ws`) |
| `scheduler.ts` | runs `tick()` every second; recomputes ratings when stats change |
| `dev/` | fake players for every sport (`npm run dev:seed`) |

```bash
npm run dev:seed                 # fictional schools/players/games for every sport + a ratings run + dev_alice/dev_bob
npm run ratings:dev -- --force   # recompute ratings now (normally automatic)
npm run ratings:top25            # top 25 per sport + the OVR distribution, for sanity checks
npx tsx src/battles/sim/calibrate.ts hockey 10000   # win rates / scores / OT / timing at +0, +5, +10 OVR
```

### Ratings

OVR 40-99 plus 4-6 sub-ratings per position (hockey F/D: SHT PAS SKT DEF PHY;
G: REF POS HND STA; basketball: SCO 3PT PLY REB DEF; soccer outfield: ATT FIN
PAS DEF DIS, GK: REF POS HND STA; volleyball: ATK SRV BLK DIG SET; football
QB: ACC ARM DEC MOB, RB: RSH ELU POW REC BAL, WR: CAT SPD PRD RZN, DEF: TKL PRS
COV TAK). Method (see `ratings/compute.ts`): stats from **2025-26 onward**,
no exhibitions; rate metrics (per game / 40 min / set / 90 min, percentages);
recency weights 0.65 current / 0.35 previous applied to each season's totals;
Bayesian shrinkage toward the position's pooled rate, `(n·x + k·base)/(n+k)`;
percentiles within sport + gender + position, also pulled toward the middle
by `n/(n+k)` so a 2-game hot streak can't rank first; a calibration curve maps
percentiles to ratings (floor 40, median 68, top 10% ≥ 80, top 1% ≥ 88).
Zero qualifying games: 60 everywhere and `is_new`. Some sub-ratings are
proxies because the box scores have no such stat (hockey SKT/PHY, soccer DEF);
their labels say so. Positions come from the roster, then the box score, then
are inferred from the stat profile (`position_source`). Kickers, linemen and
anyone else outside a battle position aren't rated.

Each recompute writes `player_ratings` and one `player_rating_history` row
per player; the API scheduler recomputes when `game_stats`/`athletes`/`games`
changed (checked every 15 min), so the nightly ingest is followed by new
ratings. A battle uses a snapshot of each pick's rating.

### Matches

Server-authoritative and deterministic: the same lineups and seed always
produce the same `MatchResult`. Regulation plays back in 150-160 s, overtime
adds 30-50 s. Overtime: hockey 3-on-3 sudden death, then a shootout (winner
credited one goal); basketball 5:00 periods; soccer golden goal, then
penalties (score stays level, `winner` set); football alternating possessions
from the 35; volleyball has none (a fifth set is the overtime segment).
Volleyball `scoreA`/`scoreB` are sets; its `clock` is the current set's points.
`side` is the team an event is about: scorer, saving team, team that lost the
ball (`turnover`), offending team (`foul`/`penalty`), winner (`final`).
Calibration (10,000 sims per sport, `test/battles-sim.test.ts`): +5 average
OVR wins about 64-66%, +10 about 76-78%.

```ts
MatchEvent  { t, period, clock, type, side, playerIds, text, scoreA, scoreB, momentum }
MatchResult { matchId, sport, seed, events, finalScoreA, finalScoreB, winner, wentToOT, durationMs }
```

### Battle states

`queued` (friend invite sent) → `drafting` → `simulating` → `complete`, plus
`cancelled` (declined, forfeited, invite cancelled) and `expired` (invite timed
out). Deadlines live in the database and a 1 s tick acts on them, so a
restart loses nothing: overdue picks are auto-picked, finished matches
completed and running streams resumed. A user is busy (409 `ALREADY_IN_BATTLE`
/ `ALREADY_QUEUED`) while drafting or simulating, while an invite they sent is
pending, or while in the ranked queue. Battles need accepted terms and follow
the athlete rule, like leagues.

### Endpoints

Sports are chosen with `sport` (`hockey`, `basketball`, `soccer`,
`volleyball`, `football`) + `gender` (`men`/`women`; football is men only), or
`sport_id` (`usports_mhk`). Battle ids are `bt_<n>`, invites `inv_<n>`,
notifications `ntf_<n>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/players?sport&gender&position` | – | Rated pool, best first: name, school, number, class year, `position`, `ovr`, `sub_ratings`, `is_new`, `ovr_change` (vs the previous run). Also `q` (name), `battle_id` (hide players drafted in it), `page`, `page_size` (≤200). No photos or logos |
| POST | `/battles/ai` | ✓ | `{sport, gender}` → 201 battle, drafting at once. The AI drafts the highest-OVR player that fits an open slot (1.2 s "thinking" delay). Unranked |
| POST | `/battles/invite` | ✓ | `{username \| user_id, sport, gender}` → 201 invite. Online friend: realtime `invite.received`, 60 s expiry. Offline: inbox notification (+ push hook), 24 h expiry |
| GET | `/battles/invites` | ✓ | `{incoming, outgoing}` (last 7 days) with `status` pending / accepted / declined / expired / cancelled |
| POST | `/battles/invite/:id/respond` | ✓ | `{accept: true\|false}` (invitee). Accept starts the draft for both. 410 `INVITE_EXPIRED` |
| DELETE | `/battles/invite/:id` | ✓ | Inviter withdraws a pending invite |
| POST | `/queue/random` | ✓ | `{sport, gender}` → 202 `{status:"queued", matching, waited_seconds, estimated_wait_seconds}` or 201 `{status:"matched", battle_id}`. Ranked |
| GET | `/queue/random` | ✓ | `queued` (as above) / `matched` / `idle` |
| DELETE | `/queue/random` | ✓ | Leave the queue (404 `NOT_QUEUED`) |
| GET | `/battles/:id` | ✓ | Participants only. State, sides, lineup slots, draft (`order`, `on_the_clock`, `deadline`), picks with rating snapshots, and `match` with only the events whose `t` has passed (`elapsed_ms`, `duration_ms`; `final` once complete) |
| POST | `/battles/:id/pick` | ✓ | `{athlete_id}`. Errors: `NOT_YOUR_TURN`, `ALREADY_PICKED`, `NO_OPEN_SLOT`, `NOT_IN_POOL`, `DRAFT_NOT_ACTIVE` |
| POST | `/battles/:id/forfeit` | ✓ | Abandon an unranked battle before the match (ranked drafts can't be abandoned: the timer auto-picks) |
| GET | `/ladder/me` | ✓ | Division, Elo, this week's cohort standings (rank, wins, losses, Elo, promotion/relegation zone), `resets_at` |
| GET | `/me/stats` | ✓ | Elo, division, ranked/provisional, this week's W-L, totals per mode, last 20 battles with score and Elo change |
| PUT | `/me/username` | ✓ | `{username}` 3-20 of `A-Za-z0-9_.`, unique (409 `USERNAME_TAKEN`) |
| GET | `/users/search?q=` | ✓ | Username / display-name prefix search, with `online` |
| GET | `/notifications` | ✓ | Inbox (unexpired), `unread` count |
| POST | `/notifications/:id/read` | ✓ | Mark read |
| POST | `/realtime/ticket` | ✓ | One-time WebSocket ticket, valid 60 s |

### Realtime

`GET /api/v1/realtime?ticket=<ticket>` upgrades to a WebSocket (locally,
with `AUTH_DEV_HEADER=true`, also `?dev_user=<subject>`). Every connection is
on its own `user:usr_<n>` channel. Client → server:
`{"op":"subscribe","channel":"battle:bt_12"}` (participants only),
`{"op":"unsubscribe",...}`, `{"op":"ping"}`. Server → client:
`{"channel","type","data","ts"}`.

| Channel | Type | Data |
|---|---|---|
| user | `hello` | `{user_id, channels}` on connect |
| user | `invite.received` | the invite (online invitee) |
| user | `invite.updated` | the invite, on every status change (both sides) |
| user | `notification.created` | an inbox item (offline invite) |
| user | `queue.status` | `{status, matching, waited_seconds, estimated_wait_seconds}` when the search widens |
| user | `queue.matched` | `{battle_id, sport_id, waited_seconds}` |
| user | `battle.created`, `battle.state` | battle id and state changes, for the user's own battles |
| user | `ladder.updated` | after a ranked battle: `{battle_id, result, elo, elo_change, division}` |
| user | `ladder.reset` | weekly outcome: `{week_start, rank, outcome, from, division}` |
| battle | `battle.sync` | sent on subscribe: the full `GET /battles/:id` view, incl. every match event already due, so a reconnecting client resumes at the right point |
| battle | `battle.state` | `drafting` (`first_pick`), `simulating` (`starts_at`, `duration_ms`), `complete` (`winner`, scores), `cancelled` |
| battle | `draft.turn` | `{pick_number, side, deadline, pick_seconds}` |
| battle | `draft.pick` | `{pick_number, side, slot, auto, player, next}` |
| battle | `match.event` | `{index, event: MatchEvent}`, emitted at `starts_at + event.t`; dedupe by `index` after a sync |
| user | `error` / `pong` | protocol replies |

The hub is in-process: one API instance. Several instances would need a
shared bus behind `RealtimeHub.publish` (e.g. Postgres `LISTEN/NOTIFY`); the
tick itself is already safe to run in several processes (`SKIP LOCKED`,
advisory locks).

### Ladder

Elo and divisions are per user across all sports: one ladder, while every
battle (and every queue match) is a single sport. Elo starts at 1000, K = 40 for the first 10 ranked matches, then 24; only
Play Random changes it. Divisions: Walk-On, Bench, Starter, Varsity,
All-Star, Captain, Hall of Fame. A player's first ranked result of a week
puts them in a cohort of up to 30 in their division; cohorts rank by weekly
wins, Elo breaks ties. At Monday 00:00 America/Toronto the top 5 move up and
the bottom 5 down (Hall of Fame: no promotion; Walk-On: no relegation).
Cohorts smaller than 10 move at most half their members each way, and
promotion needs at least one win. The reset runs from the tick and is
idempotent (`ladder_resets`).

## Errors

Every error is returned as `{ "error": { "code", "message", "details?" } }`.

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_ID`, `NO_CHANGE` |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN` |
| 403 | `NOT_IN_BATTLE`, `TERMS_NOT_ACCEPTED`, `ATHLETE_OWN_SPORT` |
| 404 | `USER_NOT_FOUND`, `NOT_QUEUED`, `NOT_FOUND`, `NO_TEAM`, `NOT_ON_ROSTER`, `UNKNOWN_SPORT`, `ROUTE_NOT_FOUND` |
| 409 | `ALREADY_IN_BATTLE`, `ALREADY_QUEUED`, `NOT_YOUR_TURN`, `ALREADY_PICKED`, `DRAFT_NOT_ACTIVE`, `INVITE_NOT_PENDING`, `USERNAME_TAKEN`, `RANKED_NO_FORFEIT`, `LEAGUE_FULL`, `ALREADY_IN_LEAGUE`, `TEAM_NAME_TAKEN`, `ATHLETE_ALREADY_ROSTERED`, `SLOT_OCCUPIED`, `ROSTER_FULL`, `TERMS_VERSION_MISMATCH`, `ATHLETE_DECLARATION_LOCKED` |
| 410 | `INVITE_EXPIRED` |
| 422 | `NO_OPEN_SLOT`, `NOT_IN_POOL`, `POOL_TOO_SMALL`, `CANNOT_INVITE_SELF`, `UNKNOWN_POSITION`, `INVALID_SLOT`, `INELIGIBLE_POSITION`, `WRONG_SPORT`, `ROSTER_SIZE_MISMATCH`, `SPORT_INACTIVE`, `NO_RULESET`, `UNKNOWN_RULESET`, `ATHLETE_SPORTS_REQUIRED`, `CONSTRAINT_VIOLATION` |

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
  battles/          Draft Battles (see the section above)
test/               vitest + supertest against a real Postgres
```

## Not built yet
- Draft, waivers, trades, and lineup locks at game time (swaps are currently allowed at any time).
- Weekly matchups and standings.
- Rate limiting. Put the API behind a gateway, or add `express-rate-limit`, before going public.
- `athlete_season_stats` is a materialized view (migration 0005) refreshed by the pipeline after every sync, so player searches read precomputed rows instead of re-aggregating every box score.
