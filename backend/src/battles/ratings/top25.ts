/**
 * npm run ratings:top25 [-- --sport usports_mhk] [-- --n 25]
 * Prints the top N rated players per battle sport (plus the OVR distribution)
 * for sanity-checking the ratings.
 */
import { createPool } from '../../db.js';
import { BATTLE_SPORT_CODES } from '../sports/index.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const n = Number(arg('--n') ?? 25);
const codes = arg('--sport')?.split(',') ?? BATTLE_SPORT_CODES;
const db = createPool(process.env.DATABASE_URL ?? 'postgres://usports:usports@localhost:5432/usports_fantasy', 2);

async function main() {
  for (const code of codes) {
    const { rows } = await db.query<{ name: string; school: string; position: string; ovr: number; sub_ratings: Record<string, number>;
      games_used: number; is_new: boolean; position_source: string }>(
      `SELECT a.first_name || ' ' || a.last_name AS name, u.name AS school, pr.position, pr.ovr, pr.sub_ratings,
              pr.games_used, pr.is_new, pr.position_source
         FROM player_ratings pr JOIN athletes a ON a.id = pr.athlete_id JOIN universities u ON u.id = a.university_id
         JOIN sports s ON s.id = pr.sport_id
        WHERE s.code = $1 ORDER BY pr.ovr DESC, pr.games_used DESC, a.last_name LIMIT $2`, [code, n]);
    const dist = (await db.query<{ n: number; p50: number; p90: number; p99: number; min: number; max: number; new: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE is_new)::int AS new,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ovr) FILTER (WHERE NOT is_new) AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY ovr) FILTER (WHERE NOT is_new) AS p90,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY ovr) FILTER (WHERE NOT is_new) AS p99,
              min(ovr) AS min, max(ovr) AS max
         FROM player_ratings pr JOIN sports s ON s.id = pr.sport_id WHERE s.code = $1`, [code])).rows[0]!;
    console.log(`\n=== ${code}: ${dist.n} rated (${dist.new} NEW) | min ${dist.min} · median ${dist.p50} · p90 ${dist.p90} · p99 ${dist.p99} · max ${dist.max}`);
    rows.forEach((r, i) => {
      const subs = Object.entries(r.sub_ratings).map(([k, v]) => `${k} ${v}`).join(' ');
      console.log(`${String(i + 1).padStart(3)}. ${String(r.ovr).padStart(2)} ${r.position.padEnd(4)} ${r.name.padEnd(24)} ${r.school.padEnd(24)} ` +
        `${String(r.games_used).padStart(3)} gp  ${subs}${r.is_new ? '  NEW' : ''}${r.position_source !== 'roster' ? `  (pos: ${r.position_source})` : ''}`);
    });
  }
}
main().then(() => db.end(), (err) => { console.error(err); process.exit(1); });
