/**
 * Test fixtures only: generated schools, athletes and box scores for the
 * Battles test database (see global-setup.ts). Never seeded into a real database.
 */
import type { Db } from '../src/db.js';
import { wipeFakeData } from '../src/battles/dev/seed.js';
import { generateFakeData, type FakeOptions } from './fake-data.js';

export async function seedFakeData(db: Db, opts: FakeOptions = {}) {
  const data = generateFakeData(opts);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await wipeFakeData(client);
    await client.query(
      `INSERT INTO universities (name, slug, conference, is_usports_member)
       SELECT name, slug, conference::conference_code, TRUE FROM jsonb_to_recordset($1::jsonb) AS x(name text, slug text, conference text)`,
      [JSON.stringify(data.universities)]);
    await client.query(
      `INSERT INTO athletes (first_name, last_name, university_id, sport_id, position, positions, jersey_number, class_year, last_seen_at)
       SELECT x.first, x.last, u.id, s.id, x.position, x.positions, x.jersey, x."classYear", now()
         FROM jsonb_to_recordset($1::jsonb)
                AS x(first text, last text, uni text, sport text, position text, positions text[], jersey text, "classYear" text)
         JOIN universities u ON u.slug = x.uni JOIN sports s ON s.code = x.sport`,
      [JSON.stringify(data.athletes)]);
    // Jersey numbers are unique per fake team, so (school, sport, jersey) identifies an athlete.
    const keyOf = new Map(data.athletes.map((a) => [`${a.uni}|${a.sport}|${a.jersey}`, a.key]));
    const athletes = await client.query<{ id: string; slug: string; code: string; jersey_number: string }>(
      `SELECT a.id, u.slug, s.code, a.jersey_number FROM athletes a
         JOIN universities u ON u.id = a.university_id JOIN sports s ON s.id = a.sport_id WHERE u.slug LIKE 'dev-%'`);
    const athleteId = new Map(athletes.rows.map((r) => [keyOf.get(`${r.slug}|${r.code}|${r.jersey_number}`)!, r.id]));
    await client.query(
      `INSERT INTO games (sport_id, source_game_id, season, season_segment, game_date, home_university_id, away_university_id,
                          home_score, away_score, status, is_conference_game)
       SELECT s.id, 'dev:' || x.key, x.season, x.season, x.date::date, h.id, a.id, x."homeScore", x."awayScore", 'FINAL', TRUE
         FROM jsonb_to_recordset($1::jsonb) AS x(key text, sport text, season text, date text, home text, away text, "homeScore" int, "awayScore" int)
         JOIN sports s ON s.code = x.sport JOIN universities h ON h.slug = x.home JOIN universities a ON a.slug = x.away`,
      [JSON.stringify(data.games)]);
    const lines = data.lines.map((l) => ({ ...l, athlete: athleteId.get(l.athlete) }));
    for (let i = 0; i < lines.length; i += 5000) {
      await client.query(
        `INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, is_starter, position, stat_payload_json)
         SELECT x.athlete, g.id, g.game_date, u.id, o.id, x.starter, x.position, x.stats
           FROM jsonb_to_recordset($1::jsonb) AS x(athlete bigint, game text, uni text, opp text, starter boolean, position text, stats jsonb)
           JOIN games g ON g.source_game_id = 'dev:' || x.game JOIN universities u ON u.slug = x.uni JOIN universities o ON o.slug = x.opp`,
        [JSON.stringify(lines.slice(i, i + 5000))]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await db.query(`SELECT 1 FROM pg_matviews WHERE matviewname = 'athlete_season_stats'`).then(async (r) => {
    if (r.rowCount) await db.query('REFRESH MATERIALIZED VIEW athlete_season_stats');
  });
  return { universities: data.universities.length, athletes: data.athletes.length, games: data.games.length, lines: data.lines.length };
}
