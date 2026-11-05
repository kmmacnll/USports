"""Ingestion workers."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import psycopg

from . import db
from .db import Jsonb
from .normalize import position_tokens
from .seasons import current_season, season_start_year
from .sports import SportAdapter, get_adapter
from .transform import build_schedule

log = logging.getLogger(__name__)


def disable_usportspy_season_check() -> None:
    """usportspy validates seasons by listing GitHub releases through
    api.github.com (unauthenticated: 60 requests/hour, and blocked on some
    networks). The data files themselves are plain release downloads, so the
    check can be skipped when the season is known to exist."""
    import usportspy.helpers as h
    h.validate_season = lambda tag, seasons: None


FETCH_ATTEMPTS = 3
FETCH_BACKOFF_S = 5.0


def fetch_with_retries(label: str, fn, attempts: int = FETCH_ATTEMPTS, backoff_s: float = FETCH_BACKOFF_S,
                       sleep=time.sleep):
    """usportspy downloads from GitHub release assets with no retries, and
    they intermittently time out (504). Retry transient failures with
    backoff; don't retry a 404 (the file doesn't exist, e.g. no data yet)."""
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - usportspy wraps everything in UsportspyError
            msg = str(e)
            if "404" in msg or attempt == attempts:
                raise
            wait = backoff_s * 2 ** (attempt - 1)
            log.info("%s: download failed (%s); retry %d/%d in %.0fs",
                     label, msg.splitlines()[-1][:120] if msg else type(e).__name__, attempt, attempts - 1, wait)
            sleep(wait)
    raise AssertionError("unreachable")


@dataclass
class Frames:
    schedule: pd.DataFrame
    players: dict[str, pd.DataFrame]


def load_frames(adapter: SportAdapter, season: str, source_dir: Path | None = None) -> Frames:
    """Fetch via usportspy, or read the same CSVs from a local directory
    (<dir>/<code>/schedule.csv and <dir>/<code>/<frame>_<season>.csv for each
    of adapter.frame_names) for offline replays and tests."""
    if source_dir:
        base = Path(source_dir) / adapter.code
        return Frames(
            schedule=pd.read_csv(base / "schedule.csv"),
            players={n: pd.read_csv(base / f"{n}_{season}.csv") for n in adapter.frame_names},
        )
    year = season_start_year(season)
    return Frames(
        schedule=fetch_with_retries(f"{adapter.code} schedule", adapter.fetch_schedule),
        players=fetch_with_retries(f"{adapter.code} box scores", lambda: adapter.fetch_frames([year])),
    )


def sync_athletes_and_stats(sport_code: str, season: str | None = None, *,
                            conn: psycopg.Connection | None = None,
                            source_dir: Path | None = None,
                            frames: Frames | None = None) -> dict:
    """Pull schedule + box scores for one sport/season and upsert them.

    Idempotent: re-running updates changed scores and stat lines in place and
    never duplicates universities, games, athletes or game_stats.
    Runs in a single transaction.
    """
    adapter = get_adapter(sport_code)
    season = season or current_season()
    frames = frames or load_frames(adapter, season, source_dir)

    teams, games = build_schedule(frames.schedule, season)
    result = adapter.build_lines(frames.players, games)
    lines, team_seasons, line_counts = result.lines, result.team_seasons, result.counts
    for t in teams:
        hint = result.name_hints.get(t.slug)
        if hint and t.name == t.name.lower():
            t.name = hint
    log.info("%s %s: %d games, %d teams (%d members), %d player lines",
             sport_code, season, len(games), len(teams), sum(t.is_member for t in teams), len(lines))

    own_conn = conn is None
    conn = conn or db.connect()
    try:
        with conn.transaction(), conn.cursor() as cur:
            sport = db.sport_id(cur, sport_code)
            uni = db.upsert_universities(cur, teams)
            game_ids = db.upsert_games(cur, sport, games, uni)
            n_team_seasons = db.upsert_team_seasons(cur, sport, season, team_seasons, uni)

            members = {t.slug for t in teams if t.is_member}
            idx = db.load_identity(cur, sport)
            reasons = {"player_id": 0, "name_key": 0, "new": 0, "name_collision": 0}
            latest: dict[int, tuple] = {}
            stat_rows: dict[tuple[int, int], tuple] = {}
            skipped_non_member = 0
            new_athletes = 0
            merged_lines = 0

            for ln in lines:
                if ln.team_slug not in members:   # exhibition opponents' players
                    skipped_non_member += 1
                    continue
                uid = uni[ln.team_slug]
                aid, reason = idx.resolve(uid, ln.name_norm, ln.player_id, ln.season_segment)
                if aid is None:
                    aid = db.insert_athlete(cur, sport, uid, ln.first_name, ln.last_name,
                                            ln.jersey_number, ln.player_id)
                    new_athletes += 1
                idx.register(aid, uid, ln.name_norm, ln.player_id, ln.season_segment, reason)
                reasons[reason] += 1
                prev = latest.get(aid)
                latest[aid] = (ln.game_date, ln.player_id or (prev[1] if prev else None), ln.jersey_number,
                               ln.position or (prev[3] if prev else None))
                gid = game_ids[ln.source_game_id]
                prev_row = stat_rows.get((aid, gid))
                if prev_row:
                    # Same athlete twice in one game: hockey lists goalies in both
                    # the skater and goalie tables. Merge (max on overlapping keys,
                    # so an exact duplicate row is never double-counted).
                    merged = dict(prev_row[6].obj)
                    for k, v in ln.stats.items():
                        merged[k] = max(merged[k], v) if k in merged else v
                    starter = bool(prev_row[5]) or bool(ln.is_starter) if (prev_row[5] is not None or ln.is_starter is not None) else None
                    stat_rows[(aid, gid)] = (*prev_row[:5], starter, Jsonb(merged))
                    merged_lines += 1
                else:
                    stat_rows[(aid, gid)] = (aid, gid, ln.game_date, uid, uni[ln.opponent_slug],
                                             ln.is_starter, Jsonb(ln.stats))

            n_keys = db.save_identity_keys(cur, sport, idx)

            # Box-score positions fill in athletes the roster sync hasn't
            # covered; a roster position (more authoritative) is never overwritten.
            cur.executemany(
                """
                UPDATE athletes
                   SET last_seen_at  = greatest(last_seen_at, %s::date::timestamptz),
                       usports_id    = coalesce(%s, usports_id),
                       jersey_number = coalesce(jersey_number, %s),
                       position      = coalesce(position, %s),
                       positions     = CASE WHEN positions = '{}' THEN %s::text[] ELSE positions END
                 WHERE id = %s
                """,
                [(d, pid, j, pos, position_tokens(pos, adapter.position_aliases), aid)
                 for aid, (d, pid, j, pos) in latest.items()],
            )

            cur.executemany(
                """
                INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id,
                                        is_starter, stat_payload_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (athlete_id, game_id) DO UPDATE SET
                    game_date = EXCLUDED.game_date, university_id = EXCLUDED.university_id,
                    opponent_id = EXCLUDED.opponent_id, is_starter = EXCLUDED.is_starter,
                    stat_payload_json = EXCLUDED.stat_payload_json
                WHERE (game_stats.stat_payload_json, game_stats.is_starter)
                      IS DISTINCT FROM (EXCLUDED.stat_payload_json, EXCLUDED.is_starter)
                RETURNING (xmax = 0) AS inserted
                """,
                list(stat_rows.values()),
                returning=True,
            )
            inserted = updated = 0
            while True:
                for (was_insert,) in cur.fetchall():
                    inserted += was_insert
                    updated += not was_insert
                if not cur.nextset():
                    break

            scored = rescore(cur, sport, season)

        summary = {
            "sport": sport_code, "season": season,
            "games": len(game_ids), "universities": len(uni), "team_seasons": n_team_seasons,
            "athletes_seen": len(latest), "athletes_new": new_athletes, "merged_lines": merged_lines,
            "identity": reasons, "identity_keys_added": n_keys,
            "stat_lines": len(stat_rows), "stat_lines_inserted": inserted, "stat_lines_updated": updated,
            "skipped_non_member_lines": skipped_non_member, "box_rows": line_counts, **scored,
        }
        return summary
    finally:
        if own_conn:
            conn.close()


def rescore(cur: psycopg.Cursor, sport: int, season: str) -> dict:
    """Recompute fantasy points for every competition of this sport+season
    (scoring lives in the DB: fantasy_score())."""
    cur.execute(
        """
        INSERT INTO game_stat_fantasy_points (game_stat_id, competition_id, points)
        SELECT gs.id, c.id, fantasy_score(gs.stat_payload_json, c.scoring_rules_json)
          FROM game_stats gs
          JOIN games g        ON g.id = gs.game_id
          JOIN competitions c ON c.sport_id = g.sport_id AND c.season = g.season
         WHERE g.sport_id = %s AND g.season = %s
           AND (c.count_exhibitions OR NOT g.is_exhibition)
        ON CONFLICT (game_stat_id, competition_id) DO UPDATE
           SET points = EXCLUDED.points, calculated_at = now()
         WHERE game_stat_fantasy_points.points <> EXCLUDED.points
        """,
        (sport, season),
    )
    competition_rows = cur.rowcount
    cur.execute(
        """
        UPDATE game_stats gs
           SET fantasy_points_calculated = fantasy_score(gs.stat_payload_json, c.scoring_rules_json)
          FROM games g, competitions c
         WHERE g.id = gs.game_id AND g.sport_id = %s AND g.season = %s
           AND c.sport_id = g.sport_id AND c.season = g.season AND c.is_default
           AND gs.fantasy_points_calculated IS DISTINCT FROM fantasy_score(gs.stat_payload_json, c.scoring_rules_json)
        """,
        (sport, season),
    )
    default_rows = cur.rowcount
    if default_rows == 0:
        cur.execute("SELECT 1 FROM competitions WHERE sport_id = %s AND season = %s AND is_default", (sport, season))
        if cur.fetchone() is None:
            log.warning("no default competition for sport %s season %s — fantasy_points_calculated left NULL",
                        sport, season)
    return {"competition_points_written": competition_rows, "default_points_updated": default_rows}
