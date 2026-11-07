/**
 * Local development: fake players for every battle sport, then a ratings run,
 * so the whole Draft Battles flow works before the scraper is finished.
 *
 *   npm run dev:seed                   # 12 fictional schools, 2025-26 + 2026-27
 *   npm run dev:seed -- --teams 8 --seed 7
 *   npm run dev:seed -- --wipe         # remove the fake data only
 *
 * Fake universities use `dev-` slugs and "(dev)" names; re-running replaces them.
 * Never run against production (refused when NODE_ENV=production).
 */
import { pathToFileURL } from 'node:url';

import type pg from 'pg';

import { createPool, type Db } from '../../db.js';
import { recomputeRatings } from '../ratings/job.js';
import { generateFakeData, type FakeOptions } from './fake-data.js';

export async function wipeFakeData(db: Db | pg.PoolClient): Promise<void> {
  const dev = `(SELECT id FROM universities WHERE slug LIKE 'dev-%')`;
  await db.query(`DELETE FROM roster_spots WHERE athlete_id IN (SELECT id FROM athletes WHERE university_id IN ${dev})`);
  await db.query(`DELETE FROM game_stats WHERE university_id IN ${dev} OR opponent_id IN ${dev}`);
  await db.query(`DELETE FROM games WHERE home_university_id IN ${dev} OR away_university_id IN ${dev}`);
  await db.query(`DELETE FROM athletes WHERE university_id IN ${dev}`);
  await db.query(`DELETE FROM universities WHERE slug LIKE 'dev-%'`);
}

/** Two local users for trying Play a Friend / Play Random with the X-Dev-User header. */
export async function seedDevUsers(db: Db) {
  await db.query(
    `INSERT INTO users (auth_subject, display_name, username, terms_version_accepted, terms_accepted_at, is_usports_athlete)
     SELECT v.sub, v.name, v.username, (SELECT version FROM terms_versions WHERE is_current), now(), FALSE
       FROM (VALUES ('dev-alice', 'Alice (dev)', 'dev_alice'), ('dev-bob', 'Bob (dev)', 'dev_bob')) v(sub, name, username)
     ON CONFLICT (auth_subject) DO UPDATE SET username = EXCLUDED.username,
       terms_version_accepted = EXCLUDED.terms_version_accepted, terms_accepted_at = now()`);
}

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to seed fake players with NODE_ENV=production');
    process.exit(1);
  }
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const db = createPool(process.env.DATABASE_URL ?? 'postgres://usports:usports@localhost:5432/usports_fantasy', 2);
  (async () => {
    if (process.argv.includes('--wipe')) {
      await wipeFakeData(db);
      console.log('✓ fake data removed');
    } else {
      const res = await seedFakeData(db, { teams: Number(arg('--teams') ?? 12), seed: Number(arg('--seed') ?? 20251) });
      console.log('✓ seeded', res);
      await seedDevUsers(db);
      console.log('✓ dev users: X-Dev-User: dev-alice (username dev_alice) and dev-bob (dev_bob), terms accepted');
    }
    console.log('→ recomputing ratings');
    console.log(JSON.stringify(await recomputeRatings(db, { force: true }), null, 2));
  })().then(() => db.end(), (err) => { console.error(err); process.exit(1); });
}
