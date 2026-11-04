# `db/` — PostgreSQL schema

Plain SQL migrations, applied with `psql` by a tiny runner. Both the Python
pipeline and the Node API read and write this schema; neither one owns it.

```
db/
├── migrate.sh                         # up | down | seed | status
├── migrations/
│   ├── 0001_init_schema.up.sql
│   └── 0001_init_schema.down.sql
├── seeds/                             # idempotent reference data
│   ├── 0001_sports.sql
│   └── 0002_default_competitions.sql
└── tests/
    └── schema_smoke_test.sql          # checks the constraints, then rolls back
```

## Quick start

```bash
docker compose up -d db
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy
./db/migrate.sh up
./db/migrate.sh seed
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/schema_smoke_test.sql
```

## Model

```
                 ┌──────────── REAL-WORLD (pipeline writes) ────────────┐
 universities ◄── athletes ──► sports ◄── games ──► universities (home/away)
                     │                      │
                     └──────► game_stats ◄──┘   raw_stats_json (JSONB, sport-specific keys)
                                   │
                 ┌─────────────────┼────── FANTASY (API writes) ─────────┐
                 │                 ▼                                      │
 sports ◄── competitions ──► game_stat_fantasy_points                    │
             │  roster_config_json / scoring_rules_json (JSONB)          │
             ▼                                                            │
 users ◄── leagues ──► fantasy_teams ──► roster_spots ──► athletes       │
```

### Why it can host any sport

| Concern        | Where it lives                       | Sport-specific? |
|----------------|--------------------------------------|-----------------|
| Box-score line | `game_stats.raw_stats_json`          | keys only       |
| Roster shape   | `competitions.roster_config_json`    | data            |
| Scoring        | `competitions.scoring_rules_json`    | data            |
| Everything else| relational columns                   | no              |

To add a sport: insert a `sports` row, have the pipeline write that sport's
stat keys, and add a `competitions` row whose scoring keys match those keys.
No migration needed.

### Additions beyond the original spec, and why

- **`games`**: gives box scores a stable upsert key (`sport_id, source_game_id`),
  handles double-headers, and stores fixtures for weekly matchups.
  `game_stats` still keeps `game_date` and `opponent_id` (copied from `games`) for fast filtering.
- **`users`**: a real FK target for `commissioner_id` and `user_id`.
  `auth_subject` holds the external auth provider's id. No credentials are stored.
- **`game_stat_fantasy_points`**: leagues in different competitions can score
  the same game differently. `game_stats.fantasy_points_calculated` is the
  score under the sport's **default** competition (`is_default = TRUE`) and is
  used for browsing and sorting.
- **`athlete_season_stats` view**: season totals for every numeric stat key,
  for any sport. It backs `GET /api/v1/athletes`.

### Invariants enforced in the database

| Rule | Mechanism |
|------|-----------|
| Re-ingesting never duplicates athletes, games, or stat lines | `UNIQUE (sport_id, usports_id)`, `UNIQUE (sport_id, source_game_id)`, `UNIQUE (athlete_id, game_id)` |
| One team per user per league | `UNIQUE (league_id, user_id)` |
| League can't exceed `max_teams` | `fantasy_teams_capacity` trigger (row-locks the league) |
| Athlete rostered at most once per league | `roster_spots.league_id` (pinned by composite FK) + `UNIQUE (league_id, athlete_id)` |
| Athlete's sport must match the league's sport | `roster_spots_sport_match` trigger |
| One athlete per concrete slot, but swaps are atomic | `roster_spots_slot_key` is `DEFERRABLE`; the swap endpoint runs `SET CONSTRAINTS roster_spots_slot_key DEFERRED` |
| At most one default ruleset per sport and season | partial unique index |

### JSON contracts

`roster_config_json`
```json
{ "slots": [ { "position": "G", "count": 2, "eligible": ["G"] },
             { "position": "UTIL", "count": 1, "eligible": ["*"] } ],
  "bench": 4, "injured_reserve": 1 }
```
Starter rows in `roster_spots` use `position_assigned` = slot position and
`slot_index` from 1 to `count`. Bench rows use `position_assigned = 'BN'`.
Injured reserve rows use `'IR'`.

`scoring_rules_json`
```json
{ "version": 1,
  "stats":   { "pts": 1, "reb": 1.2, "ast": 1.5, "to": -1 },
  "bonuses": [ { "name": "double_double", "value": 5 } ] }
```
Points = Σ `raw_stats_json[key] × stats[key]`, plus any bonuses that apply.
Keys missing from a stat line count as 0.

### Seasons

`season` is `"YYYY-YY"` for winter sports (`2025-26`) and `"YYYY"` for fall
sports such as football (`2025`).
