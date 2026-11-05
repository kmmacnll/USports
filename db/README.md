# `db/` — PostgreSQL schema

Plain SQL migrations, applied with `psql` by a tiny runner. The Python
pipeline and the Node API both read and write this schema. Neither one owns it.

```
db/
├── migrate.sh                         # up | down | seed | status
├── migrations/0001_init_schema.{up,down}.sql
├── seeds/                             # idempotent reference data
│   ├── 0001_sports.sql
│   ├── 0002_terms.sql
│   └── 0003_default_competitions.sql
└── tests/schema_smoke_test.sql        # checks every rule below with synthetic rows, then rolls back
```

```bash
docker compose up -d db
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy
./db/migrate.sh up && ./db/migrate.sh seed
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
        │ raw_stats_json {"points":20,"rebounds":5,...}
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

Sport codes: `usports_mbk`, `usports_wbk` (active); `usports_mhk`,
`usports_whk`, `usports_fb`, `usports_mvb`, `usports_wvb`, `usports_msoc`,
`usports_wsoc` (catalogued, not yet ingested).

## JSON contracts

**`competitions.scoring_rules_json`**: a flat map of stat key to points. The
keys match `game_stats.raw_stats_json`. Scoring is computed in the database by
`fantasy_score(stats, rules)`.
```json
{"points":1.0,"rebounds":1.2,"assists":1.5,"steals":3.0,"blocks":3.0,"turnovers":-1.0}
```

**`competitions.roster_config_json`**
```json
{"slot_order":           ["PG","SG","SF","PF","C","BENCH"],
 "roster_limits":        {"PG":1,"SG":1,"SF":1,"PF":1,"C":1,"BENCH":1},
 "position_eligibility": {"PG":["PG","G"],"SG":["SG","G"],"SF":["SF","F"],"PF":["PF","F"],"C":["C"]}}
```
`roster_positions: ["PG","SG","SF","PF","C","BENCH"]` is stored as one slot
per entry. `slot_order` keeps that display order, because jsonb objects don't
preserve key order. A starter slot accepts athletes whose `athletes.positions` overlap
its eligibility list. U Sports rosters mostly publish a generic G, F or C, so
G fills PG or SG and F fills SF or PF. `BENCH` (and `IR`) accept any athlete in
the sport.

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

`"YYYY-YY"` for winter sports (`2026-27`) and `"YYYY"` for fall sports such as
football. `games.season_segment` keeps the source's suffix (`2026-27p` for
playoffs, `2026-27c` for championships). The `athlete_season_stats` view leaves
out exhibition games.
