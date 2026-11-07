/**
 * Local development: two dev users for trying Battles with the X-Dev-User
 * header, then a ratings run over the real athletes the scraper has loaded.
 * It no longer creates fictional schools or athletes; it removes any that an
 * older version of this script left behind (universities with `dev-` slugs).
 *
 *   npm run dev:seed
 *
 * Never run against production (refused when NODE_ENV=production).
 */
import { pathToFileURL } from 'node:url';

import type pg from 'pg';

import { createPool, type Db } from '../../db.js';
import { recomputeRatings } from '../ratings/job.js';

/** Removes fictional dev data: universities with `dev-` slugs and everything attached to them. */
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to run the dev seed with NODE_ENV=production');
    process.exit(1);
  }
  const db = createPool(process.env.DATABASE_URL ?? 'postgres://usports:usports@localhost:5432/usports_fantasy', 2);
  (async () => {
    await wipeFakeData(db);
    console.log('✓ removed any fictional dev schools and athletes');
    await seedDevUsers(db);
    console.log('✓ dev users: X-Dev-User: dev-alice (username dev_alice) and dev-bob (dev_bob), terms accepted');
    console.log('→ recomputing ratings');
    console.log(JSON.stringify(await recomputeRatings(db, { force: true }), null, 2));
  })().then(() => db.end(), (err) => { console.error(err); process.exit(1); });
}
