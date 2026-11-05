import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';

import { authenticate } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { apiRouter, publicRouter } from './routes/index.js';
import { pinAuthRouter } from './pin-auth.js';

/**
 * `isReady` lets the server accept connections (so the host sees an open port)
 * while startup migrations are still running: until it returns true,
 * /healthz and the API answer 503.
 */
export function createApp(cfg: Config, db: Db, logger: Logger, isReady: () => boolean = () => true): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('query parser', 'simple');

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', async (_req, res) => {
    if (!isReady()) {
      res.status(503).json({ status: 'starting' });
      return;
    }
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', (_req, res, next) => {
    if (isReady()) return next();
    res.status(503).set('Retry-After', '10')
      .json({ error: { code: 'STARTING', message: 'The API is starting up; try again shortly' } });
  });

  app.use('/api/v1', pinAuthRouter(cfg));
  app.use('/api/v1', publicRouter(db));
  app.use('/api/v1', authenticate(cfg, db), apiRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
