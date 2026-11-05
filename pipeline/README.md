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
| Schedule | `usportspy.basketball_get_schedule()` | games, scores, exhibition/conference/playoff flags, team names |
| Box scores | `usportspy.basketball_get_player_box_score()` | per-game player lines, jersey, starter flag, usports.ca player and team links |
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

## Status (verified 2026-11-04 against live data)

| Piece | Status |
|---|---|
| Schedule + box-score sync, `usports_mbk` 2026-27 | ✅ ran end to end: 651 games, 48 member universities, 1,090 athletes, 4,427 stat lines; second run was a no-op |
| Identity resolution | ✅ checked on a 2025-26 dry run: 963 lines linked to returning players by name, one same-name pair split |
| `usports_wbk` 2026-27 | ✅ ran end to end: 568 games, 48 member universities, 1,057 athletes, 3,667 stat lines; second run was a no-op |
| **Roster scraper** | ⚠️ **not yet run against live en.usports.ca.** The host was blocked by the network policy of the environment where this was written. The parser is unit tested on a synthetic page only. Run `--rosters --dry-run -v` once and check the log before relying on it |
| Conferences (OUA/CW/RSEQ/AUS) | not populated yet. `universities.conference` stays NULL until a standings or roster source fills it |

### Known limitations
- Until the roster sync runs, athletes from box scores have no position. The
  database only lets them sit on `BENCH`.
- usportspy reads jersey numbers as numbers, so "00" arrives as "0". The
  roster sync restores the real text.
- usportspy checks seasons via api.github.com (60 requests/hour
  unauthenticated). `--no-season-check` skips that lookup. The data files are
  plain GitHub release downloads either way.
- A transfer between universities currently creates a new athlete record.

## Adding a sport

1. Add a `SportAdapter` in `usports_pipeline/sports.py`, mapping usportspy
   columns to canonical stat keys.
2. Add a default competition whose `scoring_rules_json` keys match those
   stat keys.
3. Set `sports.is_active = TRUE`.

Hockey and football feeds have different shapes: hockey uses `player`,
`position` and `starter_status` columns, and football is split into separate
offence, defence and kicking files. Each needs its own adapter.

## Scheduling

Box scores publish shortly after games finish. A suggested cadence during the season:

```cron
15 */2 * * *  cd /srv/usports/pipeline && .venv/bin/python ingest_usports.py --sport all
30 6 * * 1    cd /srv/usports/pipeline && .venv/bin/python ingest_usports.py --sport all --rosters --skip-stats
```
