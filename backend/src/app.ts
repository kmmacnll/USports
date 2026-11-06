import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';

import { authenticate } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { apiRouter, publicRouter } from './routes/index.js';
import { passwordAuthRouter } from './password-auth.js';
import { RealtimeHub } from './battles/realtime.js';
import { battlesPublicRouter, battlesRouter } from './battles/routes.js';
import { BattleService } from './battles/service.js';

export interface AppDeps {
  hub: RealtimeHub;
  battles: BattleService;
}

/** Realtime hub + battle service; the server (index.ts) and tests build them explicitly. */
export function createDeps(cfg: Config, db: Db, logger: Logger, opts: ConstructorParameters<typeof BattleService>[3] = {}): AppDeps {
  const hub = new RealtimeHub(logger, cfg.AUTH_DEV_HEADER);
  return { hub, battles: new BattleService(db, hub, logger, opts) };
}

/**
 * `isReady` lets the server accept connections (so the host sees an open port)
 * while startup migrations are still running: until it returns true,
 * /healthz and the API answer 503.
 */
export function createApp(cfg: Config, db: Db, logger: Logger, isReady: () => boolean = () => true,
  deps: AppDeps = createDeps(cfg, db, logger)): Express {
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

  app.use('/api/v1', passwordAuthRouter(cfg, db));
  app.use('/api/v1', publicRouter(db));
  app.use('/api/v1', battlesPublicRouter(db));
  app.use('/api/v1', authenticate(cfg, db), apiRouter(db), battlesRouter(deps.battles));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
