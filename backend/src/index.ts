import { pino } from 'pino';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrateOptionsFromEnv, runMigrations } from './migrate.js';

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  // Print plainly (no stack) so the host's deploy log shows the reason.
  console.error(`✗ startup aborted: ${(err as Error).message}`);
  process.exit(1);
}
const logger = pino({ level: cfg.LOG_LEVEL });
const db = createPool(cfg.DATABASE_URL, cfg.DATABASE_POOL_MAX);
let ready = !cfg.MIGRATE_ON_START;
const app = createApp(cfg, db, logger, () => ready);

// Listen first, so the host detects the open port even while migrations wait
// for a database that is still provisioning. Requests get 503 until ready.
const server = app.listen(cfg.PORT, () => {
  logger.info({ port: cfg.PORT, migrateOnStart: cfg.MIGRATE_ON_START,
    auth: { jwt: Boolean(cfg.JWT_SECRET || cfg.JWT_JWKS_URL), devHeader: cfg.AUTH_DEV_HEADER } },
  'usports fantasy api listening');
});

if (cfg.MIGRATE_ON_START) {
  runMigrations(migrateOptionsFromEnv())
    .then(() => {
      ready = true;
      logger.info('migrations complete; ready');
    })
    .catch((err) => {
      logger.fatal({ err }, 'startup migrations failed; exiting');
      server.close();
      setTimeout(() => process.exit(1), 100);
    });
}

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    db.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
