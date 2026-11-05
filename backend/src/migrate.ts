/**
 * Applies db/migrations/*.up.sql (once each, in order) and then db/seeds/*.sql
 * (idempotent, every run). Same bookkeeping table as db/migrate.sh, so the two
 * can be used interchangeably. Used as the Render pre-deploy step, where psql
 * is not installed.
 *
 *   npm run migrate              # migrations + seeds
 *   npm run migrate -- --no-seed # migrations only
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');
const LOCK_KEY = 727_001; // arbitrary, constant: serialises concurrent deploys

async function sqlFiles(dir: string, suffix: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith(suffix)).sort();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const seed = !process.argv.includes('--no-seed');
  const client = new pg.Client({ connectionString: url, application_name: 'usports-migrate' });
  await client.connect();
  try {
    await client.query('SET client_min_messages = warning');
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows
      .map((r) => r.version));

    for (const file of await sqlFiles(join(DB_DIR, 'migrations'), '.up.sql')) {
      const version = file.replace(/\.up\.sql$/, '');
      if (applied.has(version)) continue;
      console.log(`→ applying ${version}`);
      // Each migration file wraps itself in BEGIN/COMMIT.
      await client.query(await readFile(join(DB_DIR, 'migrations', file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    }
    console.log('✓ migrations up to date');

    if (seed) {
      for (const file of await sqlFiles(join(DB_DIR, 'seeds'), '.sql')) {
        console.log(`→ seeding ${file}`);
        await client.query(await readFile(join(DB_DIR, 'seeds', file), 'utf8'));
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
