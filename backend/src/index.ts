import { pino } from 'pino';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const cfg = loadConfig();
const logger = pino({ level: cfg.LOG_LEVEL });
const db = createPool(cfg.DATABASE_URL, cfg.DATABASE_POOL_MAX);
const app = createApp(cfg, db, logger);

const server = app.listen(cfg.PORT, () => {
  logger.info({ port: cfg.PORT, auth: { jwt: Boolean(cfg.JWT_SECRET || cfg.JWT_JWKS_URL), devHeader: cfg.AUTH_DEV_HEADER } },
    'usports fantasy api listening');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    db.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
