/**
 * Builds a throwaway database from the real migrations + seeds, then loads
 * synthetic fixtures. TEST_DATABASE_URL defaults to a local
 * `usports_api_test` database; the role needs CREATEDB.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = 'postgres://usports:usports@localhost:5432/usports_api_test';

export async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Refusing to recreate '${dbName}': test database names must contain "test"`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  const migrate = resolve(here, '../../db/migrate.sh');
  const env = { ...process.env, DATABASE_URL: url.toString() };
  execFileSync(migrate, ['up'], { env, stdio: 'pipe' });
  execFileSync(migrate, ['seed'], { env, stdio: 'pipe' });

  const fixtures = new pg.Client({ connectionString: url.toString() });
  await fixtures.connect();
  await fixtures.query(readFileSync(resolve(here, 'fixtures.sql'), 'utf8'));
  await fixtures.query('REFRESH MATERIALIZED VIEW athlete_season_stats'); // as the pipeline does after a sync
  await fixtures.end();

  process.env.TEST_DATABASE_URL = url.toString();

  // Draft Battles tests use their own database, filled with fake players for
  // every sport (src/battles/dev), so they can't disturb the fixture counts above.
  const battles = new URL(url);
  battles.pathname = `/${dbName.replace('test', 'battles_test')}`;
  const admin2 = new pg.Client({ connectionString: admin.toString() });
  await admin2.connect();
  await admin2.query(`DROP DATABASE IF EXISTS "${battles.pathname.slice(1)}" WITH (FORCE)`);
  await admin2.query(`CREATE DATABASE "${battles.pathname.slice(1)}"`);
  await admin2.end();
  const env2 = { ...process.env, DATABASE_URL: battles.toString() };
  execFileSync(migrate, ['up'], { env: env2, stdio: 'pipe' });
  execFileSync(migrate, ['seed'], { env: env2, stdio: 'pipe' });
  const { createPool } = await import('../src/db.js');
  const { seedFakeData } = await import('../src/battles/dev/seed.js');
  const { recomputeRatings } = await import('../src/battles/ratings/job.js');
  const pool = createPool(battles.toString(), 2);
  await seedFakeData(pool, { teams: 10, seed: 4242 });
  await recomputeRatings(pool, { force: true });
  await pool.end();
  process.env.TEST_BATTLES_DATABASE_URL = battles.toString();
}
