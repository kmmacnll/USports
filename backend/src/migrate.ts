/**
 * Applies db/migrations/*.up.sql (once each, in order) and then db/seeds/*.sql
 * (idempotent, every run). Same bookkeeping table as db/migrate.sh, so the two
 * can be used interchangeably. Runs before the server starts on Render, where psql
 * is not installed.
 *
 *   npm run migrate              # migrations + seeds
 *   npm run migrate -- --no-seed # migrations only
 *
 * Connection: MIGRATE_DATABASE_URL if set (e.g. Render's External Database
 * URL with ?sslmode=require), else DATABASE_URL. Transient failures (DNS not
 * resolving yet, connection refused, database starting up) are retried with
 * backoff for MIGRATE_CONNECT_TIMEOUT_S seconds (default 180), which covers
 * a database that is still being provisioned when the first deploy starts.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pg from 'pg';

const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');
const LOCK_KEY = 727_001; // arbitrary, constant: serialises concurrent deploys
const TRANSIENT = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', // cannot_connect_now (database starting up)
  '08001', '08006',
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

/** Connect, retrying transient failures until the deadline. */
async function connectWithRetry(url: string, timeoutS: number): Promise<pg.Client> {
  const deadline = Date.now() + timeoutS * 1000;
  for (let attempt = 1, wait = 2_000; ; attempt++, wait = Math.min(wait * 2, 15_000)) {
    const client = new pg.Client({ connectionString: url, application_name: 'usports-migrate', connectionTimeoutMillis: 10_000 });
    try {
      await client.connect();
      if (attempt > 1) console.log(`✓ connected to ${describe(url)} after ${attempt} attempts`);
      return client;
    } catch (err) {
      await client.end().catch(() => undefined);
      const code = (err as { code?: string }).code ?? '';
      if (!TRANSIENT.has(code) || Date.now() + wait > deadline) {
        console.error(`✗ could not connect to ${describe(url)} (${code || (err as Error).message})`);
        if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
          console.error('  The database hostname does not resolve from here. On Render, internal database hostnames');
          console.error('  only resolve for services in the same region as the database. Check both regions, or set');
          console.error('  MIGRATE_DATABASE_URL to the External Database URL (with ?sslmode=require).');
        }
        throw err;
      }
      console.log(`… ${describe(url)} not reachable yet (${code}); retrying in ${wait / 1000}s (attempt ${attempt})`);
      await sleep(wait);
    }
  }
}

async function sqlFiles(dir: string, suffix: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith(suffix)).sort();
}

export interface MigrateOptions {
  url: string;
  seed?: boolean;
  timeoutS?: number;
}

/** Options from the environment (shared by the CLI and the server's startup migration). */
export function migrateOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): MigrateOptions {
  const url = env.MIGRATE_DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const timeoutS = Number(env.MIGRATE_CONNECT_TIMEOUT_S || 180);
  return { url, timeoutS: Number.isFinite(timeoutS) ? timeoutS : 180 };
}

export async function runMigrations({ url, seed = true, timeoutS = 180 }: MigrateOptions): Promise<void> {
  console.log(`→ migrating ${describe(url)}`);
  const client = await connectWithRetry(url, timeoutS);
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

// CLI entry point (`npm run migrate`); skipped when imported by the server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations({ ...migrateOptionsFromEnv(), seed: !process.argv.includes('--no-seed') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
