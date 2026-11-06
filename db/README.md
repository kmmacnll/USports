# `db/` — PostgreSQL schema

Plain SQL migrations, applied with `psql` by a tiny runner. The Python
pipeline and the Node API both read and write this schema. Neither one owns it.

```
db/
├── migrate.sh                         # up | down | seed | status
├── migrations/
│   ├── 0001_init_schema.{up,down}.sql
│   ├── 0002_multi_sport.{up,down}.sql   # season_type, stat_payload_json, '*' eligibility
│   ├── 0003_password_auth.{up,down}.sql # users.password_hash (email sign-up)
│   ├── 0004_user_university.{up,down}.sql # users.university_id (optional, at sign-up)
│   ├── 0005_season_stats_matview.{up,down}.sql # athlete_season_stats precomputed; pipeline refreshes it
│   ├── 0006_stats_sources.{up,down}.sql   # game_stats.position, raw_source_responses (scrape cache)
│   └── 0007_player_ratings.{up,down}.sql  # Draft Battles: rating_runs, player_ratings, player_rating_history
├── seeds/                             # idempotent reference data
│   ├── 0001_sports.sql
│   ├── 0002_terms.sql
│   └── 0003_default_competitions.sql
└── tests/schema_smoke_test.sql        # checks every rule below with synthetic rows, then rolls back
```

```bash
docker compose up -d db
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy
./db/migrate.sh up && ./db/migrate.sh seed      # or, without psql: cd backend && npm run migrate:dev
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/schema_smoke_test.sql
```

## Model

```
 REAL-WORLD (pipeline writes)
   universities ◄─ university_aliases
        ▲  ▲
        │  └── team_seasons (usports.ca team page per sport+season)
        │
   athletes ◄── athlete_source_ids (every usports.ca id / name key seen)
        ▲
   game_stats ──► games ──► sports
        │ stat_payload_json {"points":20,"rebounds":5,...}
        ▼
 FANTASY (API writes)
   game_stat_fantasy_points ◄── competitions (sport+season+ruleset) ──► sports
                                     ▲
   users ── user_athlete_declarations   leagues (roster_limits_json override)
     ▲                                     ▲
     └──────── fantasy_teams ──────────────┘
                    ▲
               roster_spots ──► athletes
```

## Public ID formats

The API serialises internal `BIGINT` ids with prefixes. It never exposes the
usports.ca ids, which change every season.

| Entity | Public id | Source |
|---|---|---|
| sport | `usports_mbk` | `sports.code` |
| athlete | `usports_ath_10482` | `athletes.id` |
| league | `lg_98765` | `leagues.id` |
| user | `usr_1` | `users.id` |
| team | `tm_3` | `fantasy_teams.id` |
| ruleset | `usports_football_half_ppr` | `competitions.code` |

Active sport codes: `usports_mbk`, `usports_wbk`, `usports_fb`, `usports_mhk`,
`usports_whk`, `usports_mvb`, `usports_wvb`, `usports_msoc`, `usports_wsoc`.
Catalogued but inactive (no per-game data source): field hockey, rugby, track
& field, cross-country, swimming, wrestling, curling. Each sport has a
`season_type` (`FALL`, `WINTER` or `SPRING`).

## JSON contracts

**`competitions.code`** is the public `ruleset_id` (`usports_mbk_standard`,
`usports_football_half_ppr`). It is unique per season.

**`competitions.scoring_rules_json`** is either flat or grouped one level deep.
A grouped rule scores the stat key `<group>_<stat>`. Scoring is computed in
the database by `fantasy_score(stats, rules)`, and the stat keys match
`game_stats.stat_payload_json`.
```json
{"points":1.0,"rebounds":1.2,"assists":1.5,"steals":3.0,"blocks":3.0,"turnovers":-1.0}
{"passing":{"yards":0.04,"touchdown":4.0,"interception":-2.0,"two_point":2.0},
 "kicking":{"fg_0_39":3.0,"fg_40_49":4.0,"fg_50_plus":5.0,"pat":1.0,"single_rouge":1.0,"fg_missed":-1.0},
 "misc":{"fumble_lost":-2.0}, ...}          // passing.yards scores stat_payload_json.passing_yards
```

| Ruleset | Roster (starters + bench) |
|---|---|
| `usports_mbk_standard`, `usports_wbk_standard` | G 2, F 2, C 1 + BENCH 6 = 11 |
| `usports_football_half_ppr` | QB 2, RB 3, WR 4, K 1, DEF 1 + BENCH 4 = 15 |
| `usports_mhk_standard`, `usports_whk_standard` *(provisional)* | F 3, D 2, G 1 + BENCH 4 = 10 |
| `usports_mvb_standard`, `usports_wvb_standard` *(provisional)* | PLAYER 6 (`*` = anyone) + BENCH 4 = 10 |
| `usports_msoc_standard`, `usports_wsoc_standard` *(provisional)* | GK 1, D 3, M 3, F 2 + BENCH 4 = 13 |

Basketball eligibility is generic: G accepts G/PG/SG, F accepts F/SF/PF, C accepts C.
Football's `DEF` slot has no scoring rules yet, so it scores 0.

**`competitions.roster_config_json`**
```json
{"slot_order":           ["G","F","C","BENCH"],
 "roster_limits":        {"G":2,"F":2,"C":1,"BENCH":6},
 "position_eligibility": {"G":["G","PG","SG"],"F":["F","SF","PF"],"C":["C"]}}
```
`slot_order` keeps the display order, because jsonb objects don't preserve key
order. A starter slot accepts athletes whose `athletes.positions` overlap its
eligibility list. `"*"` in a slot's list means any athlete in the sport,
for feeds with no positions (volleyball). `BENCH` (and `IR`) accept any
athlete in the sport.

**`leagues.roster_limits_json` / `roster_size`**: these default to the
competition's limits and can be overridden per league. `roster_size` must
equal the sum of the limits.
```json
{"QB":2,"RB":3,"WR":4,"K":1,"DEF":1,"BENCH":4}   // roster_size 15
```

A roster row is (`position_assigned`, `slot_index`): for example `('PG',1)` or
`('BENCH',1)`. `slot_type` (STARTER, BENCH or INJURED_RESERVE) is derived from
`position_assigned`.

## Rules enforced in the database

| Rule | Mechanism |
|---|---|
| Re-ingesting never duplicates data | upsert keys: `universities.slug`, `games (sport_id, source_game_id)`, `game_stats (athlete_id, game_id)`, `athlete_source_ids` PK |
| **T&C:** a user must accept the current terms (and answer the athlete question) before commissioning or joining a league | `assert_user_may_play_sport()`, hint `TERMS_NOT_ACCEPTED` |
| **T&C:** a U Sports athlete can play every sport except their own | `user_athlete_declarations` + `assert_user_may_play_sport()` on `leagues` and `fantasy_teams`, hint `ATHLETE_OWN_SPORT` |
| A user can't declare a sport while still in a league for it | `user_athlete_declarations` trigger |
| One team per user per league; at most `max_teams` teams | unique constraint + trigger (`LEAGUE_FULL`) |
| League roster limits are well-formed and use only slots the competition defines | CHECK constraints + `leagues` trigger |
| An athlete is rostered at most once per league | `UNIQUE (league_id, athlete_id)`, with `league_id` pinned by a composite FK |
| A rostered athlete plays the league's sport | `roster_spots` trigger (`WRONG_SPORT`) |
| A slot exists in the league's limits | `roster_spots` trigger (`INVALID_SLOT`) |
| A starter is eligible for their slot | `roster_spots` trigger (`INELIGIBLE_POSITION`) |
| Swaps are atomic | `roster_spots_slot_key` is `DEFERRABLE`; run `SET CONSTRAINTS roster_spots_slot_key DEFERRED` inside the swap transaction |

Each trigger error uses SQLSTATE `23514` and a stable `HINT`. The API can map
the hint straight to an error code.

## Seasons

Every sport uses `"YYYY-YY"` (`2026-27`); the U Sports feeds label football
that way too. `usports_current_season()` rolls over on July 1, and the seeds
create the current season's rulesets on every deploy. `games.season_segment` keeps the source's suffix (`2026-27p` for
playoffs, `2026-27c` for championships). The `athlete_season_stats` materialized view
leaves out exhibition games. It is precomputed, so it only changes when the
pipeline refreshes it at the end of each sync (`REFRESH MATERIALIZED VIEW
CONCURRENTLY athlete_season_stats` if you edit `game_stats` by hand).
