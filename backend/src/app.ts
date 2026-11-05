import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';

import { authenticate } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { apiRouter, publicRouter } from './routes/index.js';

export function createApp(cfg: Config, db: Db, logger: Logger): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('query parser', 'simple');

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', publicRouter(db));
  app.use('/api/v1', authenticate(cfg, db), apiRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
