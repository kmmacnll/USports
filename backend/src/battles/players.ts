/**
 * GET /players: the Draft Battles player pool, ranked by fantasy points per game
 * (fppg) in the sport's newest season, with OVR and sub-ratings kept for the sim.
 * Names, school, number and class year as text only: no photos or logos.
 */
import type { Queryable } from '../db.js';
import { HttpError } from '../errors.js';
import { encodeId } from '../ids.js';
import { BY_CODE, codeFor, SPORTS } from './sports/index.js';
import type { BattleSport, Gender } from './sports/types.js';

export function resolveSportCode(input: { sport?: string; gender?: string; sport_id?: string }): string {
  if (input.sport_id) {
    if (!BY_CODE[input.sport_id]) throw new HttpError(422, 'UNKNOWN_SPORT', `${input.sport_id} is not a Draft Battles sport`);
    return input.sport_id;
  }
  const sport = input.sport?.toLowerCase() as BattleSport | undefined;
  if (!sport || !SPORTS[sport]) {
    throw new HttpError(400, 'VALIDATION_ERROR', `sport must be one of ${Object.keys(SPORTS).join(', ')} (or pass sport_id)`);
  }
  const g = (input.gender ?? (sport === 'football' ? 'men' : '')).toUpperCase().replace(/S$/, '') as string;
  const gender = (g === 'MEN' || g === 'MAN' || g === 'M' ? 'MEN' : g === 'WOMEN' || g === 'WOMAN' || g === 'W' ? 'WOMEN' : null) as Gender | null;
  if (!gender) throw new HttpError(400, 'VALIDATION_ERROR', 'gender must be men or women');
  const code = codeFor(sport, gender);
  if (!code) throw new HttpError(422, 'UNKNOWN_SPORT', `${sport} has no ${gender.toLowerCase()}'s competition`);
  return code;
}

export interface PlayerQuery {
  sportCode: string;
  position?: string;
  q?: string;
  /** internal battle id: leave out players already drafted in it */
  excludeBattle?: string;
  page: number;
  pageSize: number;
}

export async function listPlayers(db: Queryable, p: PlayerQuery) {
  const { sport, gender } = BY_CODE[p.sportCode]!;
  const cfg = SPORTS[sport];
  const pos = p.position?.toUpperCase();
  const slot = pos ? cfg.lineup.find((s) => s.slot === pos || s.position === pos) : undefined;
  if (pos && !slot) throw new HttpError(422, 'UNKNOWN_POSITION', `${sport} positions: ${cfg.lineup.map((s) => s.position).join(', ')}`);
  const words = p.q?.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g);
  const tsq = words?.length ? words.map((w) => `${w}:*`).join(' & ') : null;
  const { rows } = await db.query<{
    athlete_id: string; first_name: string; last_name: string; school: string; school_slug: string; conference: string | null;
    jersey_number: string | null; class_year: string | null; position: string; position_source: string; ovr: number;
    sub_ratings: Record<string, number>; is_new: boolean; games_used: number; prev_ovr: number | null; total: string;
    fppg: string | null; fppg_week_ago: string | null; fantasy_games: number;
  }>(
    `SELECT a.id AS athlete_id, a.first_name, a.last_name, u.name AS school, u.slug AS school_slug, u.conference,
            a.jersey_number, a.class_year, pr.position, pr.position_source, pr.ovr, pr.sub_ratings, pr.is_new, pr.games_used,
            (SELECT h.ovr FROM player_rating_history h WHERE h.athlete_id = pr.athlete_id AND h.run_id < pr.run_id
              ORDER BY h.run_id DESC LIMIT 1) AS prev_ovr,
            fp.fppg, fp.fppg_week_ago, coalesce(fp.games, 0)::int AS fantasy_games,
            count(*) OVER () AS total
       FROM player_ratings pr
       JOIN sports s ON s.id = pr.sport_id
       JOIN athletes a ON a.id = pr.athlete_id
       JOIN universities u ON u.id = a.university_id
       -- Fantasy points per game (default ruleset) this season, and as it stood a week ago for Risers.
       LEFT JOIN LATERAL (
         SELECT round(avg(gs.fantasy_points_calculated), 1) AS fppg,
                round(avg(gs.fantasy_points_calculated) FILTER (WHERE g.game_date < current_date - 7), 1) AS fppg_week_ago,
                count(*) AS games
           FROM game_stats gs JOIN games g ON g.id = gs.game_id
          WHERE gs.athlete_id = a.id AND NOT g.is_exhibition AND gs.fantasy_points_calculated IS NOT NULL
            AND g.season = (SELECT max(g2.season) FROM games g2 WHERE g2.sport_id = s.id AND NOT g2.is_exhibition)
       ) fp ON TRUE
      WHERE s.code = $1
        AND ($2::text IS NULL OR pr.position = $2)
        AND ($3::text IS NULL OR to_tsvector('simple', a.first_name || ' ' || a.last_name) @@ to_tsquery('simple', $3))
        AND ($4::bigint IS NULL OR NOT EXISTS (SELECT 1 FROM battle_picks bp WHERE bp.battle_id = $4 AND bp.athlete_id = pr.athlete_id))
      ORDER BY fp.fppg DESC NULLS LAST, pr.ovr DESC, a.last_name, a.id
      LIMIT $5 OFFSET $6`,
    [p.sportCode, slot?.position ?? null, tsq, p.excludeBattle ?? null, p.pageSize, (p.page - 1) * p.pageSize]);
  return {
    sport, gender, sport_id: p.sportCode,
    lineup: cfg.lineup.map((s) => ({ slot: s.slot, position: s.position, count: s.count, label: s.label })),
    sub_rating_labels: Object.fromEntries(Object.entries(cfg.positions).map(([k, d]) =>
      [k, Object.fromEntries(Object.entries(d.subRatings).map(([sk, sd]) => [sk, sd.label]))])),
    data: rows.map((r) => ({
      athlete_id: encodeId('athlete', r.athlete_id), first_name: r.first_name, last_name: r.last_name,
      school: r.school, school_id: r.school_slug, conference: r.conference, jersey_number: r.jersey_number, class_year: r.class_year,
      position: r.position, position_source: r.position_source, ovr: r.ovr, sub_ratings: r.sub_ratings, is_new: r.is_new,
      games_used: r.games_used, ovr_change: r.prev_ovr === null ? null : r.ovr - r.prev_ovr,
      fppg: r.fppg === null ? null : Number(r.fppg), fantasy_games: r.fantasy_games,
      fppg_change: r.fppg === null || r.fppg_week_ago === null ? null : Math.round((Number(r.fppg) - Number(r.fppg_week_ago)) * 10) / 10,
    })),
    pagination: { page: p.page, page_size: p.pageSize, total: Number(rows[0]?.total ?? 0) },
  };
}
