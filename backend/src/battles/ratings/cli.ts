/**
 * npm run ratings [-- --force] [-- --sport usports_mhk,usports_whk]
 * Recompute Draft Battles player ratings. Without --force, skips when no stat
 * line or athlete changed since the last complete run.
 */
import { createPool } from '../../db.js';
import { recomputeRatings } from './job.js';

const i = process.argv.indexOf('--sport');
const sportCodes = i > 0 ? process.argv[i + 1]?.split(',') : undefined;
const db = createPool(process.env.DATABASE_URL ?? 'postgres://usports:usports@localhost:5432/usports_fantasy', 2);
recomputeRatings(db, { force: process.argv.includes('--force'), sportCodes })
  .then((s) => console.log(JSON.stringify(s, null, 2)))
  .then(() => db.end(), (err) => { console.error(err); process.exit(1); });
