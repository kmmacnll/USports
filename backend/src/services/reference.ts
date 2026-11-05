import type { Queryable } from '../db.js';
import { getSport } from './sports.js';

/** U Sports member universities, optionally only those with athletes in a sport. */
export async function listUniversities(db: Queryable, sportCode?: string) {
  const sportId = sportCode ? (await getSport(db, sportCode)).row.id : null;
  const { rows } = await db.query<{ slug: string; name: string; conference: string | null }>(
    `SELECT u.slug, u.name, u.conference::text AS conference
       FROM universities u
      WHERE u.is_usports_member
        AND ($1::smallint IS NULL OR EXISTS (SELECT 1 FROM athletes a WHERE a.university_id = u.id AND a.sport_id = $1))
      ORDER BY u.name`,
    [sportId],
  );
  return rows.map((u) => ({ university_id: u.slug, name: u.name, conference: u.conference }));
}

interface GameRow {
  source_game_id: string;
  game_date: string;
  status: string;
  is_exhibition: boolean;
  is_playoff: boolean;
  is_conference_game: boolean;
  home_slug: string;
  home_name: string;
  home_score: number | null;
  away_slug: string;
  away_name: string;
  away_score: number | null;
}

/** Real games for a sport in a date window (inclusive), oldest first. */
export async function listGames(db: Queryable, sportCode: string, from: string, to: string, limit: number) {
  const { row: sport } = await getSport(db, sportCode);
  const { rows } = await db.query<GameRow>(
    `SELECT g.source_game_id, to_char(g.game_date, 'YYYY-MM-DD') AS game_date, g.status,
            g.is_exhibition, g.is_playoff, g.is_conference_game,
            h.slug AS home_slug, h.name AS home_name, g.home_score,
            a.slug AS away_slug, a.name AS away_name, g.away_score
       FROM games g
       JOIN universities h ON h.id = g.home_university_id
       JOIN universities a ON a.id = g.away_university_id
      WHERE g.sport_id = $1 AND g.game_date BETWEEN $2::date AND $3::date
      ORDER BY g.game_date, g.id
      LIMIT $4`,
    [sport.id, from, to, limit],
  );
  return rows.map((g) => ({
    game_id: g.source_game_id,
    date: g.game_date,
    status: g.status,
    exhibition: g.is_exhibition,
    playoff: g.is_playoff,
    conference_game: g.is_conference_game,
    home: { university_id: g.home_slug, name: g.home_name, score: g.home_score },
    away: { university_id: g.away_slug, name: g.away_name, score: g.away_score },
  }));
}
