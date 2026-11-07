/**
 * Runs BattleService.tick() every second (pick timers, match completion,
 * stream recovery, invite expiry, queue matching, weekly ladder reset) and
 * the ratings recompute whenever the stats changed (checked every 15 min).
 */
import type { Logger } from 'pino';

import type { Db } from '../db.js';
import { BATTLES } from './config.js';
import { recomputeRatings } from './ratings/job.js';
import type { BattleService } from './service.js';

export function startScheduler(db: Db, battles: BattleService, logger: Logger, opts: { tickMs?: number; ratings?: boolean } = {}) {
  const tick = setInterval(() => {
    battles.tick().catch((err) => logger.error({ err }, 'battle tick failed'));
  }, opts.tickMs ?? 1000);
  let ratingsBusy = false;
  const ratings = async () => {
    if (ratingsBusy) return;
    ratingsBusy = true;
    try {
      const res = await recomputeRatings(db);
      if (!res.skipped) logger.info({ runId: res.runId, sports: Object.keys(res.sports).length }, 'player ratings recomputed');
    } catch (err) {
      logger.error({ err }, 'ratings recompute failed');
    } finally {
      ratingsBusy = false;
    }
  };
  const ratingsTimer = opts.ratings === false ? undefined : setInterval(ratings, BATTLES.ratings.recomputeCheckMs);
  if (opts.ratings !== false) setTimeout(ratings, 5_000).unref();
  return () => {
    clearInterval(tick);
    if (ratingsTimer) clearInterval(ratingsTimer);
    battles.stop();
  };
}
