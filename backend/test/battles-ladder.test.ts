import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, createDeps, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { cohortOutcomes, eloDeltas, kFactor, nextReset, rankCohort, weekStart, zonedMidnight } from '../src/battles/ladder.js';

let db: Db;
let app: ReturnType<typeof createApp>;
let deps: AppDeps;
let clock = Date.now() + 3 * 86_400_000;
const as = (s: string) => ({ 'X-Dev-User': s });
const advance = (ms: number) => { clock += ms; };

async function user(subject: string): Promise<string> {
  const me = await request(app).get('/api/v1/me').set(as(subject)).expect(200);
  if (me.body.terms.needs_acceptance) {
    await request(app).put('/api/v1/me/terms').set(as(subject))
      .send({ terms_version: me.body.terms.current_version, is_usports_athlete: false }).expect(200);
  }
  return me.body.user_id.slice(4);
}

beforeAll(() => {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_BATTLES_DATABASE_URL!, AUTH_DEV_HEADER: 'true' });
  db = createPool(cfg.DATABASE_URL, 6);
  deps = createDeps(cfg, db, pino({ level: 'silent' }), { now: () => new Date(clock) });
  app = createApp(cfg, db, pino({ level: 'silent' }), () => true, deps);
});
afterAll(async () => {
  deps.battles.stop();
  await db.end();
});

describe('Elo', () => {
  it('K = 40 for the first 10 ranked matches, then 24', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(9)).toBe(40);
    expect(kFactor(10)).toBe(24);
  });

  it('equal players move by K/2; upsets move more; zero-sum with equal K', () => {
    expect(eloDeltas(1000, 1000, true, 40, 40)).toEqual({ a: 20, b: -20 });
    expect(eloDeltas(1000, 1000, false, 24, 24)).toEqual({ a: -12, b: 12 });
    const upset = eloDeltas(1000, 1400, true, 24, 24);
    const expected = eloDeltas(1400, 1000, true, 24, 24);
    expect(upset.a).toBeGreaterThan(expected.a);
    expect(upset.a + upset.b).toBe(0);
    expect(eloDeltas(1000, 1000, true, 40, 24)).toEqual({ a: 20, b: -12 });
  });
});

describe('weeks (Monday 00:00 America/Toronto)', () => {
  it('week boundaries follow Toronto local time, across DST', () => {
    expect(weekStart(new Date('2026-11-09T04:30:00Z'))).toBe('2026-11-02');   // Sun 23:30 EST
    expect(weekStart(new Date('2026-11-09T05:00:00Z'))).toBe('2026-11-09');   // Mon 00:00 EST
    expect(weekStart(new Date('2026-07-06T03:59:00Z'))).toBe('2026-06-29');   // Sun 23:59 EDT
    expect(weekStart(new Date('2026-07-06T04:00:00Z'))).toBe('2026-07-06');
    expect(zonedMidnight('2026-11-09').toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(zonedMidnight('2026-07-06').toISOString()).toBe('2026-07-06T04:00:00.000Z');
    expect(nextReset(new Date('2026-11-06T21:00:00Z')).toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(nextReset(new Date('2026-10-31T12:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');  // DST ends Nov 1
  });
});

describe('cohort outcomes', () => {
  const cohort = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: String(i + 1), wins: n - i, losses: i, elo: 1000 }));

  it('top 5 promote, bottom 5 relegate; ranked by wins, Elo breaks ties', () => {
    const out = cohortOutcomes(cohort(30), 'STARTER');
    expect([...out.values()].filter((o) => o === 'promoted')).toHaveLength(5);
    expect([...out.values()].filter((o) => o === 'relegated')).toHaveLength(5);
    expect(out.get('1')).toBe('promoted');
    expect(out.get('30')).toBe('relegated');
    expect(out.get('15')).toBe('stayed');
    const tie = rankCohort([{ userId: '1', wins: 3, losses: 0, elo: 1000 }, { userId: '2', wins: 3, losses: 1, elo: 1100 }]);
    expect(tie[0]!.userId).toBe('2');
  });

  it('Hall of Fame has no promotion, Walk-On no relegation; small cohorts; promotion needs a win', () => {
    const hof = cohortOutcomes(cohort(30), 'HALL_OF_FAME');
    expect([...hof.values()]).not.toContain('promoted');
    expect([...hof.values()].filter((o) => o === 'relegated')).toHaveLength(5);
    const walk = cohortOutcomes(cohort(30), 'WALK_ON');
    expect([...walk.values()]).not.toContain('relegated');
    const small = cohortOutcomes(cohort(4), 'BENCH');
    expect([...small.values()]).toEqual(['promoted', 'promoted', 'relegated', 'relegated']);
    const winless = cohortOutcomes([{ userId: '1', wins: 0, losses: 2, elo: 1000 }, { userId: '2', wins: 0, losses: 1, elo: 990 }], 'BENCH');
    expect(winless.get('1')).toBe('stayed');
    expect(winless.get('2')).toBe('relegated');
  });
});

async function playToEnd(battleId: string) {
  for (let i = 0; i < 40; i++) {
    const { rows: [b] } = await db.query<{ state: string }>('SELECT state FROM battles WHERE id = $1', [battleId.slice(3)]);
    if (b!.state === 'complete') return;
    advance(b!.state === 'drafting' ? 21_000 : 300_000);
    await deps.battles.tick();
  }
  throw new Error('battle did not finish');
}

describe('ranked battles, ladder and stats (database)', () => {
  it('a ranked win moves Elo (K=40, +20/-20 between equals) and counts toward the weekly ladder; unranked does not', async () => {
    const w = await user('lad-winner');
    const l = await user('lad-loser');
    await db.query(`INSERT INTO battle_profiles (user_id, division) VALUES ($1, 'STARTER'), ($2, 'STARTER')
                    ON CONFLICT (user_id) DO UPDATE SET division = 'STARTER'`, [w, l]);
    await request(app).post('/api/v1/queue/random').set(as('lad-winner')).send({ sport: 'hockey', gender: 'women' }).expect(202);
    const m = await request(app).post('/api/v1/queue/random').set(as('lad-loser')).send({ sport: 'hockey', gender: 'women' }).expect(201);
    await playToEnd(m.body.battle_id);
    const { rows: [b] } = await db.query('SELECT winner, user_a, elo_a_before, elo_a_after, elo_b_before, elo_b_after FROM battles WHERE id = $1',
      [m.body.battle_id.slice(3)]);
    expect([b.elo_a_before, b.elo_b_before]).toEqual([1000, 1000]);
    expect(Math.abs(b.elo_a_after - 1000)).toBe(20);
    expect(b.elo_a_after + b.elo_b_after).toBe(2000);
    const winnerSubject = (b.winner === 'A') === (b.user_a === w) ? 'lad-winner' : 'lad-loser';
    const loserSubject = winnerSubject === 'lad-winner' ? 'lad-loser' : 'lad-winner';

    const st = (await request(app).get('/api/v1/me/stats').set(as(winnerSubject)).expect(200)).body;
    expect(st).toMatchObject({ elo: 1020, division: 'STARTER', ranked: { played: 1, provisional: true }, this_week: { wins: 1, losses: 0 },
      totals: { RANDOM: { played: 1, wins: 1, losses: 0 } } });
    expect(st.recent[0]).toMatchObject({ battle_id: m.body.battle_id, mode: 'RANDOM', ranked: true, result: 'W', elo_change: 20 });
    const lad = (await request(app).get('/api/v1/ladder/me').set(as(loserSubject)).expect(200)).body;
    expect(lad).toMatchObject({ elo: 980, division: 'STARTER', division_name: 'Starter' });
    expect(lad.cohort).toMatchObject({ size: 2, rank: 2, wins: 0, losses: 1, promotion_spots: 1, relegation_spots: 1 });
    expect(lad.cohort.standings.map((s: { name: string }) => s.name).length).toBe(2);
    expect(new Date(lad.week.resets_at).getTime()).toBeGreaterThan(clock);
    expect(deps.hub.recent.some((x) => x.type === 'ladder.updated')).toBe(true);

    // an unranked AI battle changes nothing
    const ai = await request(app).post('/api/v1/battles/ai').set(as(winnerSubject)).send({ sport: 'hockey', gender: 'women' }).expect(201);
    await playToEnd(ai.body.battle_id);
    const after = (await request(app).get('/api/v1/me/stats').set(as(winnerSubject)).expect(200)).body;
    expect(after.elo).toBe(1020);
    expect(after.ranked.played).toBe(1);
    expect(after.totals.AI.played).toBe(1);
    expect(after.recent[0]).toMatchObject({ mode: 'AI', elo_change: null, opponent: 'VarsityHQ AI' });
  }, 60_000);

  it('cohorts hold at most 30 players', async () => {
    const week = '2031-01-06';
    const ids: string[] = [];
    for (let i = 0; i < 31; i++) ids.push(await user(`lad-cohort-${i}`));
    await deps.battles.tx(async (client) => {
      for (const id of ids) await (deps.ladder as unknown as { membership: (c: unknown, u: string, w: string, d: string, e: number) => Promise<void> })
        .membership(client, id, week, 'CAPTAIN', 1000);
    });
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ladder_memberships WHERE week_start = $1 GROUP BY cohort_id ORDER BY 1 DESC`, [week]);
    expect(rows.map((r) => r.n)).toEqual([30, 1]);
    await db.query(`DELETE FROM ladder_cohorts WHERE week_start = $1`, [week]);
  });

  it('weekly reset promotes and relegates, once', async () => {
    const week = weekStart(new Date(clock - 7 * 86_400_000));
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await user(`lad-reset-${i}`));
    const { rows: [c] } = await db.query<{ id: string }>(`INSERT INTO ladder_cohorts (week_start, division) VALUES ($1, 'VARSITY') RETURNING id`, [week]);
    for (const [i, id] of ids.entries()) {
      await db.query(`INSERT INTO battle_profiles (user_id, division, elo) VALUES ($1, 'VARSITY', $2)
                      ON CONFLICT (user_id) DO UPDATE SET division = 'VARSITY', elo = $2`, [id, 1000 + i]);
      await db.query(`INSERT INTO ladder_memberships (week_start, user_id, cohort_id, division, wins, losses, elo_at_start)
                      VALUES ($1, $2, $3, 'VARSITY', $4, 2, 1000)`, [week, id, c!.id, 12 - i]);
    }
    await deps.battles.tick();
    const div = async (id: string) => (await db.query<{ division: string }>('SELECT division FROM battle_profiles WHERE user_id = $1', [id])).rows[0]!.division;
    expect(await Promise.all(ids.slice(0, 5).map(div))).toEqual(Array(5).fill('ALL_STAR'));
    expect(await div(ids[5]!)).toBe('VARSITY');
    expect(await Promise.all(ids.slice(7).map(div))).toEqual(Array(5).fill('STARTER'));
    const { rows: [r] } = await db.query('SELECT promoted, relegated FROM ladder_resets WHERE week_start = $1', [week]);
    expect(r).toMatchObject({ promoted: 5, relegated: 5 });
    const note = await request(app).get('/api/v1/notifications').set(as('lad-reset-0')).expect(200);
    expect(note.body.data[0]).toMatchObject({ kind: 'ladder_reset', payload: { outcome: 'promoted', division: 'ALL_STAR', rank: 1 } });
    // idempotent
    await deps.ladder.weeklyReset();
    expect(await div(ids[0]!)).toBe('ALL_STAR');
  });
});
