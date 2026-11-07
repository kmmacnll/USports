# `pipeline/` — U Sports ingestion

Python 3.11+. Pulls **current-season** U Sports data and upserts it into the
schema in `db/`. Nothing is hard-coded: universities, conference membership,
athletes, games and stats all come from published U Sports data on each run.

```bash
cd pipeline
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy

python ingest_usports.py --sport all                       # every active sport in the database
python ingest_usports.py --sport usports_mhk,usports_mvb   # specific sports
python ingest_usports.py --sport usports_mbk --rosters     # ...plus usports.ca roster pages
python ingest_usports.py --sport all --dry-run             # run everything, then roll back
python ingest_usports.py --sport all --strict              # exit 1 if any sport fails
python ingest_usports.py --sport all --backfill            # every season from 2025-26 (the floor) to now
python ingest_usports.py --sport all --in-season-only      # nightly: skip sports out of season
python ingest_usports.py --sport all --cache-dir .cache    # keep raw CSVs of every download, reuse < 6h old
python ingest_usports.py --check-sources                   # robots.txt status of every scraped site
pytest -q                                                  # unit tests (offline)
PIPELINE_TEST_DATABASE_URL=postgres://…/postgres pytest -q  # + integration tests on a real Postgres
```

Re-running is safe and cheap. A second run with no source changes writes 0 rows.

## Data floor: 2025-26 onward only

`seasons.MIN_SEASON = "2025-26"`. `--season` refuses anything earlier, and
`load_frames()` / `sync_athletes_and_stats()` refuse it too, so no code path
can ingest an older season. `--backfill` ingests every season from the floor
to the current one; the nightly job ingests the current season only.

## Sources, robots.txt and terms (Draft Battles phase 1)

Stats reach `sync_athletes_and_stats()` through one interface,
`sources.StatsSource` (`schedule()` + `box_frames()`, returning the frames the
`BoxScoreSpec`s describe). A licensed feed later replaces the scrapers by
implementing those two methods; nothing downstream changes.

| Source | Class | Notes |
|---|---|---|
| usportspy (default) | `UsportspySource` | open U Sports data published as GitHub release CSVs |
| local CSVs | `CsvDirSource` | `--source-dir`; offline replays and tests |
| raw cache | `CachingSource` | `--cache-dir`: keeps a raw copy of every frame downloaded and reuses it while fresh |
| OUA, Canada West, RSEQ, AUS | `CONFERENCE_SITES` | **not enabled.** Each needs its robots.txt checked (`--check-sources`) and a person to review its terms and set `terms_reviewed=True`; `conference_source()` refuses until then |

Every HTML page (roster pages today, conference pages later) is fetched
through `polite_http.PoliteHttpClient`:
- **robots.txt** is read once per host per run, and a disallowed URL is never
  requested (`RobotsDisallowed`). If robots.txt is unreachable (5xx/network),
  the host is treated as disallowed;
- **rate limit**: one request per host every 2 s, or the host's `Crawl-delay` if longer;
- **raw responses** are stored in `raw_source_responses` (migration 0006), one
  row per URL, and refetched conditionally (ETag / Last-Modified);
- 429/5xx responses are retried with backoff.

> ⚠️ robots.txt and the terms of oua.ca, canadawest.org, rseq.ca,
> atlanticuniversitysport.com and en.usports.ca could **not** be read from the
> environment this was written in (its network policy blocks those hosts). Run
> `python ingest_usports.py --check-sources` from a machine that can reach them,
> and read each site's terms, before enabling any conference source.

Raw stat lines (`game_stats`, incl. the per-game box-score `position`) are
stored separately from computed ratings (`player_ratings`, owned by the API's
Draft Battles module), so ratings can always be recomputed from scratch.
Player photos are never fetched or stored.

## Data sources

| Data | Source | Gives us |
|---|---|---|
| Schedules | `usportspy.*_get_schedule()` | games, scores, exhibition/conference/playoff flags, team names |
| Basketball box scores | `basketball_get_player_box_score()` | per-game player lines, jersey, starter flag, usports.ca player and team links |
| Hockey box scores | `ice_hockey_get_player_box_score()` | skater and goalie lines; positions (C/LW/RW/D/G) for starters |
| Volleyball box scores | `volleyball_get_player_box_score()` | per-match lines (kills, digs, aces, blocks...); no positions |
| Soccer box scores | `soccer_get_player_box_score()` | goals, assists, shots, saves, minutes, cards; positions |
| Football box scores | `usportspy.fb_get_offence()`, `fb_get_kicking()`, `fb_get_defence()`, `fb_get_scoring_summaries()` | merged into one line per player per game; FG distances and singles come from the scoring summaries |
| Rosters | en.usports.ca team pages (`usports_pipeline/rosters.py`, BeautifulSoup, optional Playwright) | position, height, class year, hometown, and athletes who haven't played yet |

`usportspy` has no roster endpoint for team sports, so roster details come
from usports.ca. The team page URLs are taken from the box-score feed, not
guessed.

### Sports covered

| Sport | Status |
|---|---|
| Basketball M/W, football, hockey M/W, volleyball M/W, soccer M/W | ✅ ingested (active in `sports`) |
| Field hockey | catalogued, inactive: no 2026-27 player box score in usportspy |
| Rugby | catalogued, inactive: schedules only, no player stats |
| Track & field, cross-country, swimming, wrestling | catalogued, inactive: rankings/meet results, not head-to-head games. They need a meet-based fantasy model |
| Curling | catalogued, inactive: not in usportspy |
| Lacrosse | not a U Sports sport |

### How box scores are normalised

`transform.build_player_lines()` is one generic normaliser. Each sport
declares a `BoxScoreSpec` in `usports_pipeline/sports.py`:
- **columns:** name, team label, home/away side, jersey, position and starter flag;
- **stats:** a map from source columns to canonical stat keys, plus optional derived stats (soccer cards).

The output is a flat `{key: number}` stat payload, stored in
`game_stats.stat_payload_json`. Teams are resolved by, in order: the
home/away column; an index label (hockey writes `1`/`2` for away/home,
verified against final scores); or the team name matched to the schedule.

### Resilience
- **Per-sport isolation.** Each sport runs in its own committed
  transaction. A failure (schema drift, missing file, network) rolls back
  only that sport, logs `WARNING … FAILED … continuing`, and appears under
  `failures` in the JSON summary. The exit code is 0 unless every sport
  failed, or `--strict` is set and any sport failed.
- **Schema drift.** Before parsing, each spec checks its required columns and
  raises `SchemaDriftError` naming what's missing. A missing *optional* stat
  column is only counted (`missing_stat_columns`).
- **Download retries.** Transient GitHub errors (e.g. 504) are retried twice
  with backoff. 404s aren't retried.
- **Data-quality guards**, each found in the live 2026-27 feeds:
  - mojibake (`MontrÃ©al`) is repaired;
  - player links that a feed repeats across several players (soccer: 357 of
    615 ids) are discarded for the mismatched rows;
  - an athlete listed twice in one game (hockey goalies, in both the skater
    and goalie tables) is merged into one line;
  - dates exported as day counts (`20684`) are converted.
- **Games missing from the schedule** are rebuilt from their box scores
  (`rebuild.py`): teams from `team`/`team_name` + `team_status` (championship
  seeds like "(8) Guelph" stripped), the date from the game id, playoff from
  the player links' season segment, exhibition if dated before the season's
  first conference game. Soccer scores come from each side's keepers' goals
  against; other sports keep NULL scores. Only games between teams already in
  this season's schedule (at least one a member) are rebuilt. The run summary
  reports `games_rebuilt` and `games_unresolved`. In 2025-26 this restored 69
  games (7 football, 28 men's and 34 women's soccer) and about 2,100 stat lines.

### Derived, not hard-coded
- **U Sports membership:** a team is a member if it plays at least one conference
  game this season. Exhibition opponents (NCAA, colleges, all-star teams) are
  stored as non-members. Their games are kept, but their players are skipped.
- **Team identity:** each box-score row is mapped to the schedule's home or away
  team through `(game_id, team_status)`. The box score's own team label is not
  used because it differs from the schedule ("TorontoMetropolitan" vs "TMU").
- **Athlete identity:** see `usports_pipeline/identity.py`. usports.ca player
  ids change every season and for playoffs, and most early-season rows have
  none. Every id is recorded in `athlete_source_ids` and resolved by player id,
  then by (university, normalised name). Two same-name players on one team
  are split apart once they have different player ids in the same season.
- **Fantasy points:** computed in Postgres (`fantasy_score()`) for every
  competition of the sport and season.

## Status (verified 2026-11-05 against live data)

| Piece | Status |
|---|---|
| Schedule + box-score sync, `usports_mbk` 2026-27 | ✅ ran end to end: 651 games, 48 member universities, 1,090 athletes, 4,427 stat lines; second run was a no-op |
| Identity resolution | ✅ checked on a 2025-26 dry run: 963 lines linked to returning players by name, one same-name pair split |
| `usports_wbk` 2026-27 | ✅ ran end to end: 568 games, 48 member universities, 1,057 athletes, 3,667 stat lines; second run was a no-op |
| `usports_fb` 2026-27 | ✅ ran end to end: 102 games, 27 member universities, 1,414 athletes, 5,474 stat lines, every row matched to a team; second run was a no-op |
| Hockey, volleyball, soccer 2026-27 | ✅ ran end to end; counts are in the PR that added them. The new rulesets are **provisional** |
| **Roster scraper** | ⚠️ **not yet verified against live en.usports.ca** (blocked from the environment this was written in). It used to find team pages only through the basketball feed's team links, so hockey, volleyball, soccer and football rosters were never even requested. It now also discovers every sport's team pages from `en.usports.ca/sports/<path>/<season>/teams`, and a run that syncs no team fails with the reason (`HTTP 403`, `blocked by robots.txt`, `no roster table on page`, ...). Check the `varsityhq-rosters` log after the next run |
| Conferences (OUA/CW/RSEQ/AUS) | not populated yet. `universities.conference` stays NULL until a standings or roster source fills it |

### Football scoring coverage (Half-PPR)

| Rule | Source | Status |
|---|---|---|
| passing / rushing / receiving yards, TDs, INTs, receptions, fumbles lost | offence feed | ✅ |
| PAT, missed FG | kicking feed | ✅ |
| FG 0-39 / 40-49 / 50+ | scoring-summary distances | ✅ 279 of 302 made FGs have a distance; the rest score as 0-39 and are counted in `fg_distance_unknown` |
| single / rouge | scoring summaries (credited to the kicker) | ✅ |
| two-point conversions | not in the feeds (3 mentions all season, no clear player attribution) | ❌ score 0 |
| `DEF` slot | defence stats are stored (`defence_*`) but the ruleset has no defence rules | scores 0 |

The football feeds carry no team page links; football team pages are found
through the teams index page instead. Until a roster sync succeeds, football
positions are inferred from stats for Draft Battles ratings.

### Known limitations
- Until the roster sync runs, athletes from box scores have no position. The
  database only lets them sit on `BENCH`.
- usportspy reads jersey numbers as numbers, so "00" arrives as "0". The
  roster sync restores the real text.
- usportspy checks seasons via api.github.com (60 requests/hour
  unauthenticated). `--no-season-check` skips that lookup. The data files are
  plain GitHub release downloads either way.
- A transfer between universities currently creates a new athlete record.
- Some football schedule rows have no date. The date is taken from the game id instead (`20260822_qaam` → 2026-08-22).

## Adding a sport

1. **Single-file box score:** declare a `BoxScoreSpec` (columns, stat-key
   map, required columns) and register it with `_single_file(...)` in
   `usports_pipeline/sports.py`. No parsing code is needed.
   **Multi-file box score:** write a builder like `football.py`.
2. Add a default competition in `db/seeds/0003_default_competitions.sql`,
   with scoring keys matching the canonical stat keys. Use `"*"` in
   `position_eligibility` if the feed has no positions.
3. Set the sport's `is_active = TRUE` in `db/seeds/0001_sports.sql`.
   `--sport all` picks it up automatically.

## Scheduling

On Render, both jobs are defined in `render.yaml` (see `docs/deploy-render.md`):
stats daily at 2 AM Eastern (`--in-season-only`, so a sport's job is a no-op
outside its season window in `seasons.SEASON_WINDOWS`), rosters weekly. The API
recomputes player ratings when it sees new stat lines (see `backend/README.md`). Both pass `--no-season-check`, because
the GitHub API is rate-limited per IP and Render's outbound IPs are shared.
