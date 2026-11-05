# `pipeline/` — U Sports ingestion

Python 3.11+. Pulls **current-season** U Sports data and upserts it into the
schema in `db/`. Nothing is hard-coded: universities, conference membership,
athletes, games and stats all come from published U Sports data on each run.

```bash
cd pipeline
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgres://usports:usports@localhost:5432/usports_fantasy

python ingest_usports.py --sport usports_mbk               # schedule + box scores, current season
python ingest_usports.py --sport usports_mbk --rosters     # ...plus usports.ca roster pages
python ingest_usports.py --sport all --dry-run             # run everything, then roll back
pytest -q                                                  # unit tests (offline)
```

Re-running is safe and cheap. A second run with no source changes writes 0 rows.

## Data sources

| Data | Source | Gives us |
|---|---|---|
| Schedule | `usportspy.basketball_get_schedule()`, `fb_get_schedule()` | games, scores, exhibition/conference/playoff flags, team names |
| Basketball box scores | `usportspy.basketball_get_player_box_score()` | per-game player lines, jersey, starter flag, usports.ca player and team links |
| Football box scores | `usportspy.fb_get_offence()`, `fb_get_kicking()`, `fb_get_defence()`, `fb_get_scoring_summaries()` | merged into one line per player per game; FG distances and singles come from the scoring summaries |
| Rosters | en.usports.ca team pages (`usports_pipeline/rosters.py`, BeautifulSoup, optional Playwright) | position, height, class year, hometown, and athletes who haven't played yet |

`usportspy` has no roster endpoint for team sports, so roster details come
from usports.ca. The team page URLs are taken from the box-score feed, not
guessed.

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
| **Roster scraper** | ⚠️ **not yet run against live en.usports.ca.** The host was blocked by the network policy of the environment where this was written. The parser is unit tested on a synthetic page only. Run `--rosters --dry-run -v` once and check the log before relying on it |
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

The football feeds carry no team page links, so the roster scraper can't
find football rosters yet. Football athletes have no positions until it can.

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

1. Add a `SportAdapter` in `usports_pipeline/sports.py`: what to fetch
   (`fetch_frames`) and how to turn those frames into player lines
   (`build_lines`). Single-file box scores can reuse `build_player_lines`
   with a `BoxScoreSpec`. Multi-file sports get their own module
   (`football.py`).
2. Add a default competition whose `scoring_rules_json` keys match those
   stat keys.
3. Set `sports.is_active = TRUE`.

Hockey's feed uses `player`, `position` and `starter_status` columns, so it
needs its own `BoxScoreSpec`. It is the only adapter here whose feed includes
positions.

## Scheduling

On Render, both jobs are defined in `render.yaml` (see `docs/deploy-render.md`):
stats every 2 hours, rosters weekly. Both pass `--no-season-check`, because
the GitHub API is rate-limited per IP and Render's outbound IPs are shared.
