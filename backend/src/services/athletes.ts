import type { Queryable } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { encodeId } from '../ids.js';
import { currentSeason, summarizeStats } from '../sport-display.js';
import { getSport } from './sports.js';

export interface AthleteSearch {
  sport: string;
  university?: string;   // slug ("carleton") or numeric id
  q?: string;
  position?: string;
  conference?: string;
  season?: string;
  /** Only athletes not rostered in this league (internal id). */
  availableInLeague?: string;
  sort: 'fantasy_points' | 'name';
  page: number;
  pageSize: number;
}

interface AthleteRow {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  positions: string[];
  jersey_number: string | null;
  height: string | null;
  class_year: string | null;
  status: string;
  university_name: string;
  university_slug: string;
  conference: string | null;
  sport_code: string;
  games_played: string | null;   // bigint
  fantasy_points_avg: string | null;
  fantasy_points_total: string | null;
  stat_averages: Record<string, number> | null;
  total: string;
}

/** "mar rob" -> "mar:* & rob:*" (prefix search on the GIN name index). */
function toPrefixQuery(q: string): string | null {
  const words = q.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g);
  return words?.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

export async function searchAthletes(db: Queryable, p: AthleteSearch) {
  const { row: sport } = await getSport(db, p.sport);
  const season = p.season ?? sport.season ?? currentSeason();
  const uniId = p.university && /^\d+$/.test(p.university) ? p.university : null;
  const uniSlug = p.university && !uniId ? p.university.toLowerCase() : null;
  const tsq = p.q ? toPrefixQuery(p.q) : null;
  if (p.q && !tsq) throw new HttpError(400, 'VALIDATION_ERROR', 'q must contain letters or digits');

  const order = p.sort === 'name'
    ? 'a.last_name, a.first_name, a.id'
    : 'st.fantasy_points_avg DESC NULLS LAST, a.last_name, a.first_name, a.id';

  const { rows } = await db.query<AthleteRow>(
    `SELECT a.id, a.first_name, a.last_name, a.position, a.positions, a.jersey_number, a.height,
            a.class_year, a.status,
            u.name AS university_name, u.slug AS university_slug, u.conference,
            $1::text AS sport_code,
            st.games_played, st.fantasy_points_avg, st.fantasy_points_total, st.stat_averages,
            count(*) OVER () AS total
       FROM athletes a
       JOIN universities u ON u.id = a.university_id
       LEFT JOIN athlete_season_stats st ON st.athlete_id = a.id AND st.season = $2
      WHERE a.sport_id = $3
        AND ($4::bigint IS NULL OR u.id = $4)
        AND ($5::text   IS NULL OR u.slug = $5)
        AND ($6::text   IS NULL OR to_tsvector('simple', a.first_name || ' ' || a.last_name) @@ to_tsquery('simple', $6))
        AND ($7::text   IS NULL OR $7 = ANY (a.positions))
        AND ($10::text  IS NULL OR u.conference::text = $10)
        AND ($11::bigint IS NULL OR NOT EXISTS (
              SELECT 1 FROM roster_spots rs WHERE rs.league_id = $11 AND rs.athlete_id = a.id))
      ORDER BY ${order}
      LIMIT $8 OFFSET $9`,
    [sport.code, season, sport.id, uniId, uniSlug, tsq, p.position?.toUpperCase() ?? null,
     p.pageSize, (p.page - 1) * p.pageSize, p.conference?.toUpperCase() ?? null, p.availableInLeague ?? null],
  );

  return {
    season,
    data: rows.map(formatAthlete),
    pagination: { page: p.page, page_size: p.pageSize, total: Number(rows[0]?.total ?? 0) },
  };
}

function formatAthlete(r: AthleteRow) {
  return {
    athlete_id: encodeId('athlete', r.id),
    first_name: r.first_name,
    last_name: r.last_name,
    university: r.university_name,
    university_id: r.university_slug,
    conference: r.conference,
    sport: r.sport_code,
    position: r.position,
    positions: r.positions,
    jersey_number: r.jersey_number,
    height: r.height,
    class_year: r.class_year,
    status: r.status,
    stats: {
      games_played: Number(r.games_played ?? 0),
      ...summarizeStats(r.sport_code, r.stat_averages),
      fantasy_points_avg: r.fantasy_points_avg === null ? null : Number(r.fantasy_points_avg),
      fantasy_points_total: r.fantasy_points_total === null ? 0 : Number(r.fantasy_points_total),
    },
  };
}

interface GameLogRow {
  game_date: string;
  source_game_id: string;
  opponent: string;
  is_home: boolean;
  team_score: number | null;
  opponent_score: number | null;
  is_exhibition: boolean;
  is_playoff: boolean;
  raw_stats_json: Record<string, number>;
  fantasy_points_calculated: string | null;
}

/** One athlete: profile, current-season stats, and the most recent games. */
export async function getAthlete(db: Queryable, athleteId: string, games = 10) {
  const { rows } = await db.query<{ sport_code: string }>(
    `SELECT s.code AS sport_code FROM athletes a JOIN sports s ON s.id = a.sport_id WHERE a.id = $1`, [athleteId]);
  const sportCode = rows[0]?.sport_code;
  if (!sportCode) throw notFound('Athlete');
  const { row: sport } = await getSport(db, sportCode);
  const season = sport.season ?? currentSeason();

  const { rows: profile } = await db.query<AthleteRow>(
    `SELECT a.id, a.first_name, a.last_name, a.position, a.positions, a.jersey_number, a.height,
            a.class_year, a.status, u.name AS university_name, u.slug AS university_slug, u.conference,
            $2::text AS sport_code, st.games_played, st.fantasy_points_avg, st.fantasy_points_total,
            st.stat_averages, 1 AS total
       FROM athletes a JOIN universities u ON u.id = a.university_id
       LEFT JOIN athlete_season_stats st ON st.athlete_id = a.id AND st.season = $3
      WHERE a.id = $1`,
    [athleteId, sportCode, season],
  );
  const { rows: log } = await db.query<GameLogRow>(
    `SELECT to_char(g.game_date, 'YYYY-MM-DD') AS game_date, g.source_game_id, opp.name AS opponent,
            g.home_university_id = gs.university_id AS is_home,
            CASE WHEN g.home_university_id = gs.university_id THEN g.home_score ELSE g.away_score END AS team_score,
            CASE WHEN g.home_university_id = gs.university_id THEN g.away_score ELSE g.home_score END AS opponent_score,
            g.is_exhibition, g.is_playoff, gs.raw_stats_json, gs.fantasy_points_calculated
       FROM game_stats gs
       JOIN games g ON g.id = gs.game_id
       JOIN universities opp ON opp.id = gs.opponent_id
      WHERE gs.athlete_id = $1 AND g.season = $2
      ORDER BY g.game_date DESC, g.id DESC
      LIMIT $3`,
    [athleteId, season, games],
  );
  return {
    ...formatAthlete(profile[0]!),
    season,
    games: log.map((g) => ({
      date: g.game_date,
      game_id: g.source_game_id,
      opponent: g.opponent,
      home: g.is_home,
      result: g.team_score === null || g.opponent_score === null ? null
        : `${g.team_score > g.opponent_score ? 'W' : g.team_score < g.opponent_score ? 'L' : 'T'} ${g.team_score}-${g.opponent_score}`,
      exhibition: g.is_exhibition,
      playoff: g.is_playoff,
      stats: g.raw_stats_json,
      fantasy_points: g.is_exhibition || g.fantasy_points_calculated === null ? null : Number(g.fantasy_points_calculated),
    })),
  };
}
