/**
 * Ratings job: load every battle sport's stat totals (2025-26 onward, no
 * exhibitions), run computeRatings(), and store player_ratings + one
 * player_rating_history row per player per run.
 *
 * Runs from `npm run ratings`, and from the API scheduler whenever the inputs'
 * fingerprint (game_stats + athletes) changed since the last complete run, so
 * the nightly ingest is followed by a recompute without a second cron.
 */
import type { Db, Queryable } from '../../db.js';
import { BATTLES } from '../config.js';
import { BATTLE_SPORT_CODES, BY_CODE, sportConfig } from '../sports/index.js';
import type { Totals } from '../sports/types.js';
import { computeRatings, type PlayerInput, type PlayerRating } from './compute.js';

const LOCK_KEY = 727_002;

export interface RatingsSummary {
  skipped?: 'unchanged' | 'locked';
  runId?: string;
  seasons?: string[];
  sports: Record<string, { rated: number; new: number; byPosition: Record<string, number> }>;
}

/** Seasons in use, newest first: the floor up to the newest season with data. */
export async function ratingSeasons(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ season: string }>(
    `SELECT DISTINCT season FROM games WHERE season >= $1 ORDER BY season DESC`, [BATTLES.ratings.minSeason]);
  const current = (await db.query<{ s: string }>('SELECT usports_current_season() AS s')).rows[0]!.s;
  const all = new Set([current, ...rows.map((r) => r.season)]);
  return [...all].filter((s) => s >= BATTLES.ratings.minSeason && s <= current).sort().reverse();
}

export async function inputsWatermark(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ w: string }>(
    `SELECT concat_ws('|',
              (SELECT count(*) FROM game_stats), (SELECT max(updated_at) FROM game_stats),
              (SELECT count(*) FROM athletes),   (SELECT max(updated_at) FROM athletes),
              (SELECT count(*) FROM games),      (SELECT max(updated_at) FROM games)) AS w`);
  return rows[0]!.w;
}

export async function loadPlayerInputs(db: Queryable, sportCode: string, seasons: string[]): Promise<PlayerInput[]> {
  const floor = BATTLES.ratings.minSeason;
  const sport = (await db.query<{ id: number }>('SELECT id FROM sports WHERE code = $1', [sportCode])).rows[0];
  if (!sport) return [];
  const [athletes, games, totals, box] = await Promise.all([
    // Athletes seen since the floor season began (roster sync or a box score).
    db.query<{ id: string; positions: string[]; position: string | null }>(
      `SELECT a.id, a.positions, a.position FROM athletes a
        WHERE a.sport_id = $1
          AND (a.last_seen_at >= make_date(left($2, 4)::int, 7, 1)
               OR EXISTS (SELECT 1 FROM game_stats gs JOIN games g ON g.id = gs.game_id
                           WHERE gs.athlete_id = a.id AND g.season >= $2))`,
      [sport.id, floor]),
    db.query<{ athlete_id: string; season: string; games: number; scored: number; tf: number | null; ta: number | null }>(
      `SELECT gs.athlete_id, g.season, count(*)::int AS games,
              count(*) FILTER (WHERE g.home_score IS NOT NULL AND g.away_score IS NOT NULL)::int AS scored,
              sum(CASE WHEN g.home_university_id = gs.university_id THEN g.home_score ELSE g.away_score END)::float8 AS tf,
              sum(CASE WHEN g.home_university_id = gs.university_id THEN g.away_score ELSE g.home_score END)::float8 AS ta
         FROM game_stats gs JOIN games g ON g.id = gs.game_id
        WHERE g.sport_id = $1 AND g.season = ANY($2) AND NOT g.is_exhibition
        GROUP BY 1, 2`, [sport.id, seasons]),
    db.query<{ athlete_id: string; season: string; key: string; total: number }>(
      `SELECT gs.athlete_id, g.season, kv.key, sum(kv.value::text::numeric)::float8 AS total
         FROM game_stats gs JOIN games g ON g.id = gs.game_id
         CROSS JOIN LATERAL jsonb_each(gs.stat_payload_json) kv
        WHERE g.sport_id = $1 AND g.season = ANY($2) AND NOT g.is_exhibition AND jsonb_typeof(kv.value) = 'number'
        GROUP BY 1, 2, 3`, [sport.id, seasons]),
    db.query<{ athlete_id: string; position: string; n: number }>(
      `SELECT gs.athlete_id, gs.position, count(*)::int AS n
         FROM game_stats gs JOIN games g ON g.id = gs.game_id
        WHERE g.sport_id = $1 AND g.season = ANY($2) AND gs.position IS NOT NULL
        GROUP BY 1, 2`, [sport.id, seasons]),
  ]);

  const byId = new Map<string, PlayerInput>();
  const ensure = (id: string) => {
    let p = byId.get(id);
    if (!p) byId.set(id, (p = { athleteId: id, rosterPositions: [], seasons: {}, boxPositions: {} }));
    return p;
  };
  for (const a of athletes.rows) Object.assign(ensure(a.id), { rosterPositions: a.positions, rawPosition: a.position });
  const season = (p: PlayerInput, s: string): Totals => (p.seasons[s] ??= {});
  for (const g of games.rows) {
    const t = season(ensure(g.athlete_id), g.season);
    t.games = g.games;
    t._scored_games = g.scored;
    t._team_for = g.tf ?? 0;
    t._team_against = g.ta ?? 0;
  }
  for (const r of totals.rows) {
    const p = byId.get(r.athlete_id);
    if (p) season(p, r.season)[r.key] = r.total;
  }
  for (const r of box.rows) {
    const p = byId.get(r.athlete_id);
    if (p) p.boxPositions![r.position] = r.n;
  }
  return [...byId.values()];
}

async function storeRatings(db: Db, runId: string, sportCode: string, ratings: PlayerRating[]) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const sport = (await client.query<{ id: number }>('SELECT id FROM sports WHERE code = $1', [sportCode])).rows[0]!;
    const payload = JSON.stringify(ratings.map((r) => ({
      athlete_id: r.athleteId, position: r.position, position_source: r.positionSource, ovr: r.ovr,
      sub_ratings: r.subRatings, games_used: r.gamesUsed, is_new: r.isNew,
    })));
    await client.query(
      `INSERT INTO player_ratings (athlete_id, sport_id, position, position_source, ovr, sub_ratings,
                                   games_used, is_new, run_id, computed_at)
       SELECT x.athlete_id, $2, x.position, x.position_source, x.ovr, x.sub_ratings, x.games_used, x.is_new, $3, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(athlete_id bigint, position text, position_source text, ovr smallint,
                                                 sub_ratings jsonb, games_used int, is_new boolean)
       ON CONFLICT (athlete_id) DO UPDATE SET
         sport_id = EXCLUDED.sport_id, position = EXCLUDED.position, position_source = EXCLUDED.position_source,
         ovr = EXCLUDED.ovr, sub_ratings = EXCLUDED.sub_ratings, games_used = EXCLUDED.games_used,
         is_new = EXCLUDED.is_new, run_id = EXCLUDED.run_id, computed_at = now()`,
      [payload, sport.id, runId]);
    // Athletes no longer rated (e.g. now a kicker) leave the pool.
    await client.query('DELETE FROM player_ratings WHERE sport_id = $1 AND run_id <> $2', [sport.id, runId]);
    await client.query(
      `INSERT INTO player_rating_history (athlete_id, run_id, position, ovr, sub_ratings, games_used, is_new)
       SELECT athlete_id, run_id, position, ovr, sub_ratings, games_used, is_new
         FROM player_ratings WHERE sport_id = $1 AND run_id = $2`, [sport.id, runId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function recomputeRatings(db: Db, opts: { force?: boolean; sportCodes?: string[] } = {}): Promise<RatingsSummary> {
  const lock = await db.connect();
  try {
    const got = (await lock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0]!.ok;
    if (!got) return { skipped: 'locked', sports: {} };
    try {
      const watermark = await inputsWatermark(db);
      if (!opts.force) {
        const last = (await db.query<{ stats_watermark: string }>(
          `SELECT stats_watermark FROM rating_runs WHERE status = 'complete' ORDER BY id DESC LIMIT 1`)).rows[0];
        if (last?.stats_watermark === watermark) return { skipped: 'unchanged', sports: {} };
      }
      const seasons = await ratingSeasons(db);
      const run = (await db.query<{ id: string }>(
        `INSERT INTO rating_runs (seasons, params, stats_watermark) VALUES ($1, $2, $3) RETURNING id`,
        [seasons, JSON.stringify({ seasonWeights: BATTLES.ratings.seasonWeights, calibration: BATTLES.ratings.calibration }),
         watermark])).rows[0]!;
      const summary: RatingsSummary = { runId: run.id, seasons, sports: {} };
      try {
        const existing = new Set((await db.query<{ code: string }>('SELECT code FROM sports')).rows.map((r) => r.code));
        let total = 0;
        for (const code of (opts.sportCodes ?? BATTLE_SPORT_CODES).filter((c) => existing.has(c) && BY_CODE[c])) {
          const cfg = sportConfig(BY_CODE[code]!.sport);
          const ratings = computeRatings(cfg, await loadPlayerInputs(db, code, seasons), { seasons });
          await storeRatings(db, run.id, code, ratings);
          const byPosition: Record<string, number> = {};
          for (const r of ratings) byPosition[r.position] = (byPosition[r.position] ?? 0) + 1;
          summary.sports[code] = { rated: ratings.length, new: ratings.filter((r) => r.isNew).length, byPosition };
          total += ratings.length;
        }
        await db.query(`UPDATE rating_runs SET status = 'complete', finished_at = now(), players_rated = $2 WHERE id = $1`,
          [run.id, total]);
      } catch (err) {
        await db.query(`UPDATE rating_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
          [run.id, String((err as Error).message ?? err)]);
        throw err;
      }
      return summary;
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    lock.release();
  }
}
