"""Database access helpers (psycopg 3)."""
from __future__ import annotations

import os

import psycopg
from psycopg.types.json import Jsonb


def connect(dsn: str | None = None) -> psycopg.Connection:
    dsn = dsn or os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is not set (see .env.example)")
    return psycopg.connect(dsn, application_name="usports-ingest")


def sport_id(cur: psycopg.Cursor, code: str) -> int:
    cur.execute("SELECT id FROM sports WHERE code = %s", (code,))
    row = cur.fetchone()
    if row is None:
        raise SystemExit(f"sport {code!r} is not in the sports table — run ./db/migrate.sh seed")
    return row[0]


def upsert_universities(cur: psycopg.Cursor, teams) -> dict[str, int]:
    """-> slug -> university_id. Aliased slugs resolve to their canonical row."""
    cur.execute("SELECT alias_slug, university_id FROM university_aliases")
    aliases = dict(cur.fetchall())
    direct = [t for t in teams if t.slug not in aliases]
    cur.executemany(
        """
        INSERT INTO universities (name, slug, is_usports_member)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name,
               is_usports_member = universities.is_usports_member OR EXCLUDED.is_usports_member
         WHERE universities.name IS DISTINCT FROM EXCLUDED.name
            OR (EXCLUDED.is_usports_member AND NOT universities.is_usports_member)
        """,
        [(t.name, t.slug, t.is_member) for t in direct],
    )
    # Members discovered through an alias still get flagged.
    cur.executemany(
        "UPDATE universities SET is_usports_member = TRUE WHERE id = %s AND NOT is_usports_member",
        [(aliases[t.slug],) for t in teams if t.slug in aliases and t.is_member],
    )
    cur.execute("SELECT slug, id FROM universities WHERE slug = ANY(%s)", ([t.slug for t in direct],))
    ids = dict(cur.fetchall())
    ids.update({t.slug: aliases[t.slug] for t in teams if t.slug in aliases})
    return ids


def upsert_games(cur: psycopg.Cursor, sport: int, games, uni: dict[str, int]) -> dict[str, int]:
    cur.executemany(
        """
        INSERT INTO games (sport_id, source_game_id, season, season_segment, game_date,
                           home_university_id, away_university_id, home_score, away_score,
                           status, is_exhibition, is_conference_game, is_playoff, box_score_url)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (sport_id, source_game_id) DO UPDATE SET
            season = EXCLUDED.season, season_segment = EXCLUDED.season_segment,
            game_date = EXCLUDED.game_date,
            home_university_id = EXCLUDED.home_university_id,
            away_university_id = EXCLUDED.away_university_id,
            home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
            status = EXCLUDED.status, is_exhibition = EXCLUDED.is_exhibition,
            is_conference_game = EXCLUDED.is_conference_game, is_playoff = EXCLUDED.is_playoff,
            box_score_url = EXCLUDED.box_score_url
        WHERE (games.home_score, games.away_score, games.status, games.game_date,
               games.is_exhibition, games.is_conference_game, games.is_playoff)
              IS DISTINCT FROM
              (EXCLUDED.home_score, EXCLUDED.away_score, EXCLUDED.status, EXCLUDED.game_date,
               EXCLUDED.is_exhibition, EXCLUDED.is_conference_game, EXCLUDED.is_playoff)
        """,
        [(sport, g.source_game_id, g.season, g.season_segment, g.game_date,
          uni[g.home_slug], uni[g.away_slug], g.home_score, g.away_score, g.status,
          g.is_exhibition, g.is_conference_game, g.is_playoff, g.box_score_url) for g in games],
    )
    cur.execute("SELECT source_game_id, id FROM games WHERE sport_id = %s AND source_game_id = ANY(%s)",
                (sport, [g.source_game_id for g in games]))
    return dict(cur.fetchall())


def upsert_team_seasons(cur: psycopg.Cursor, sport: int, season: str, records, uni: dict[str, int]) -> int:
    rows = [(uni[r.slug], sport, season, r.usports_team_id, r.team_url) for r in records if r.slug in uni]
    cur.executemany(
        """
        INSERT INTO team_seasons (university_id, sport_id, season, usports_team_id, team_url)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (sport_id, season, university_id) DO UPDATE
           SET usports_team_id = EXCLUDED.usports_team_id, team_url = EXCLUDED.team_url
         WHERE team_seasons.team_url IS DISTINCT FROM EXCLUDED.team_url
        """,
        rows,
    )
    return len(rows)


def load_identity(cur: psycopg.Cursor, sport: int):
    from .identity import IdentityIndex
    idx = IdentityIndex()
    cur.execute(
        "SELECT id_type::text, id_value, athlete_id, season_segment FROM athlete_source_ids WHERE sport_id = %s",
        (sport,),
    )
    for id_type, id_value, aid, seg in cur.fetchall():
        idx.add(id_type, id_value, aid, seg, new=False)
    return idx


def save_identity_keys(cur: psycopg.Cursor, sport: int, idx) -> int:
    cur.executemany(
        """
        INSERT INTO athlete_source_ids (sport_id, id_type, id_value, athlete_id, season_segment)
        VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
        """,
        [(sport, t, v, a, s) for t, v, a, s in idx.new_keys],
    )
    n = len(idx.new_keys)
    idx.new_keys.clear()
    return n


def insert_athlete(cur: psycopg.Cursor, sport: int, university_id: int, first: str, last: str,
                   jersey: str | None = None, usports_id: str | None = None) -> int:
    cur.execute(
        """
        INSERT INTO athletes (sport_id, university_id, first_name, last_name, jersey_number, usports_id)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """,
        (sport, university_id, first, last, jersey, usports_id),
    )
    return cur.fetchone()[0]


__all__ = ["Jsonb", "connect", "sport_id", "upsert_universities", "upsert_games",
           "upsert_team_seasons", "load_identity", "save_identity_keys", "insert_athlete"]
