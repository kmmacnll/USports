import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool, type Db } from '../src/db.js';
import { BATTLES } from '../src/battles/config.js';
import { generateFakeData } from './fake-data.js';
import {
  calibrate, computeRatings, percentileRanks, type PlayerInput, resolvePosition, shrink, weightedMean, weightedTotals,
} from '../src/battles/ratings/compute.js';
import { loadPlayerInputs, ratingSeasons, recomputeRatings } from '../src/battles/ratings/job.js';
import { BY_CODE, SPORTS, sportConfig } from '../src/battles/sports/index.js';

const hockey = sportConfig('hockey');

/** a hockey forward with `games` games at the given per-game rates (one season) */
function forward(id: string, games: number, rates: { g?: number; a?: number; s?: number; pm?: number; pim?: number; ga?: number },
  season = '2026-27', position = 'F'): PlayerInput {
  const t = (x = 0) => x * games;
  return {
    athleteId: id, rosterPositions: [position],
    seasons: games === 0 ? {} : { [season]: {
      games, goals: t(rates.g ?? 0.3), assists: t(rates.a ?? 0.4), shots: t(rates.s ?? 2.5), plus_minus: t(rates.pm ?? 0),
      penalty_minutes: t(rates.pim ?? 0.6), _team_against: t(rates.ga ?? 3), _scored_games: games,
    } },
  };
}

/** a pool of ordinary forwards with spread-out production */
function pool(n: number, position = 'F'): PlayerInput[] {
  return Array.from({ length: n }, (_, i) => {
    const z = (i / (n - 1)) * 2 - 1;     // -1 .. 1
    return forward(`p${i}`, 25, { g: 0.3 + 0.15 * z, a: 0.4 + 0.15 * z, s: 2.5 + 0.8 * z, pm: 0.3 * z, ga: 3 - 0.4 * z }, '2026-27', position);
  });
}

describe('shrinkage', () => {
  it('pulls small samples toward the baseline and leaves large samples alone', () => {
    expect(shrink(2.0, 0, 0.3, 8)).toBe(0.3);
    expect(shrink(2.0, 2, 0.3, 8)).toBeCloseTo((2 * 2 + 8 * 0.3) / 10);
    expect(shrink(2.0, 8, 0.3, 8)).toBeCloseTo(1.15);                // n = k: halfway
    expect(shrink(2.0, 400, 0.3, 8)).toBeGreaterThan(1.95);
  });

  it('a player with 2 hot games does not rate like a star', () => {
    const players = [...pool(80), forward('hot', 2, { g: 3, a: 3, s: 8, pm: 3, ga: 1 })];
    const hot = computeRatings(hockey, players).find((r) => r.athleteId === 'hot')!;
    expect(hot.ovr).toBeLessThan(90);
    // without shrinkage the same two games would top the pool
    const raw = computeRatings({ ...hockey, ratings: { k: 0 } }, players);
    const unshrunk = raw.find((r) => r.athleteId === 'hot')!;
    expect(unshrunk.ovr).toBeGreaterThan(hot.ovr + 10);
    expect(unshrunk.ovr).toBe(Math.max(...raw.map((r) => r.ovr)));
    // and a proven 25-game star still outranks the hot streak
    const shrunk = computeRatings(hockey, players);
    expect(shrunk.find((r) => r.athleteId === 'p79')!.ovr).toBeGreaterThan(hot.ovr);
  });

  it('players with zero qualifying games get the baseline and the NEW flag', () => {
    const r = computeRatings(hockey, [...pool(20), forward('fresh', 0, {})]).find((x) => x.athleteId === 'fresh')!;
    expect(r).toMatchObject({ ovr: BATTLES.ratings.baselineOvr, isNew: true, gamesUsed: 0 });
    expect(Object.values(r.subRatings).every((x) => x === BATTLES.ratings.baselineOvr)).toBe(true);
    expect(Object.keys(r.subRatings).sort()).toEqual(['DEF', 'PAS', 'PHY', 'SHT', 'SKT']);
  });
});

describe('percentile mapping', () => {
  it('mid-rank percentiles, ties share a rank', () => {
    expect(percentileRanks([10, 20, 30, 40])).toEqual([0.125, 0.375, 0.625, 0.875]);
    const tied = percentileRanks([5, 1, 5, 9]);
    expect(tied[0]).toBe(tied[2]);
    expect(tied[1]).toBeLessThan(tied[0]!);
    expect(tied[3]).toBeGreaterThan(tied[0]!);
  });

  it('calibration curve: floor 40, median 68, top 10% >= 80, top 1% >= 88', () => {
    expect(calibrate(0)).toBe(40);
    expect(calibrate(0.5)).toBe(68);
    expect(calibrate(0.9)).toBe(80);
    expect(calibrate(0.99)).toBe(88);
    expect(calibrate(1)).toBe(99);
    expect(calibrate(0.25)).toBe(54);
  });

  it('a large pool lands on the target distribution', () => {
    const r = computeRatings(hockey, pool(400)).map((x) => x.ovr).sort((a, b) => a - b);
    const q = (p: number) => r[Math.floor(p * (r.length - 1))]!;
    expect(r[0]).toBeGreaterThanOrEqual(40);
    expect(Math.abs(q(0.5) - 68)).toBeLessThanOrEqual(1);
    expect(q(0.9)).toBeGreaterThanOrEqual(79);
    expect(q(0.99)).toBeGreaterThanOrEqual(87);
  });

  it('lower-is-better metrics are inverted (goalie GAA)', () => {
    const goalies: PlayerInput[] = Array.from({ length: 20 }, (_, i) => ({
      athleteId: `g${i}`, rosterPositions: ['G'],
      seasons: { '2026-27': { games: 20, minutes: 1200, saves: 500, shots_against: 550, goals_allowed: 30 + i * 2 } },
    }));
    const r = computeRatings(hockey, goalies);
    const best = r.find((x) => x.athleteId === 'g0')!;
    const worst = r.find((x) => x.athleteId === 'g19')!;
    expect(best.subRatings.POS).toBeGreaterThan(worst.subRatings.POS!);
  });
});

describe('position weighting', () => {
  it('weightedMean normalises by the weights present', () => {
    expect(weightedMean({ A: 80, B: 60 }, { A: 0.75, B: 0.25 })).toBe(75);
    expect(weightedMean({ A: 80 }, { A: 0.5, B: 0.5 })).toBe(80);
  });

  it('the same stat line ranks differently at F and D because OVR weights differ', () => {
    // sniper: lots of goals and shots, poor defensive numbers; stopper: the reverse
    const sniper = (pos: string) => forward('sniper', 25, { g: 0.7, s: 4.5, a: 0.4, pm: -0.6, ga: 4.2 }, '2026-27', pos);
    const stopper = (pos: string) => forward('stopper', 25, { g: 0.1, s: 1.4, a: 0.4, pm: 0.8, ga: 1.9 }, '2026-27', pos);
    const asF = computeRatings(hockey, [...pool(60, 'F'), sniper('F'), stopper('F')]);
    const asD = computeRatings(hockey, [...pool(60, 'D'), sniper('D'), stopper('D')]);
    const ovr = (rs: typeof asF, id: string) => rs.find((r) => r.athleteId === id)!.ovr;
    expect(ovr(asF, 'sniper')).toBeGreaterThan(ovr(asF, 'stopper'));
    expect(ovr(asD, 'stopper')).toBeGreaterThan(ovr(asD, 'sniper'));
  });

  it('every position config has 4-6 sub-ratings and OVR weights over exactly those', () => {
    for (const cfg of Object.values(SPORTS)) {
      for (const [pos, def] of Object.entries(cfg.positions)) {
        const subs = Object.keys(def.subRatings);
        expect(subs.length, `${cfg.sport} ${pos}`).toBeGreaterThanOrEqual(4);
        expect(subs.length, `${cfg.sport} ${pos}`).toBeLessThanOrEqual(6);
        for (const k of Object.keys(def.ovrWeights)) expect(subs, `${cfg.sport} ${pos} ${k}`).toContain(k);
        for (const sub of Object.values(def.subRatings)) {
          for (const m of Object.keys(sub.metrics)) expect(cfg.metrics[m], `${cfg.sport} metric ${m}`).toBeDefined();
        }
      }
      for (const slot of cfg.lineup) expect(cfg.positions[slot.position], `${cfg.sport} slot ${slot.slot}`).toBeDefined();
    }
  });
});

describe('recency and positions', () => {
  it('weights the current season 0.65 and the previous 0.35', () => {
    const t = weightedTotals({ '2026-27': { games: 10, goals: 10 }, '2025-26': { games: 10, goals: 0 } }, ['2026-27', '2025-26'], [0.65, 0.35]);
    expect(t.goals).toBeCloseTo(6.5);
    expect(t.games).toBeCloseTo(10);
    const improving = { athleteId: 'up', rosterPositions: ['F'], seasons: {
      '2026-27': { games: 20, goals: 16, assists: 16, shots: 70, _scored_games: 20, _team_against: 60 },
      '2025-26': { games: 20, goals: 2, assists: 2, shots: 30, _scored_games: 20, _team_against: 60 } } };
    const declining = { athleteId: 'down', rosterPositions: ['F'], seasons: {
      '2026-27': improving.seasons['2025-26'], '2025-26': improving.seasons['2026-27'] } };
    const r = computeRatings(hockey, [...pool(40), improving, declining], { seasons: ['2026-27', '2025-26'] });
    expect(r.find((x) => x.athleteId === 'up')!.ovr).toBeGreaterThan(r.find((x) => x.athleteId === 'down')!.ovr);
  });

  it('position: roster first, then box score, then inferred from stats; unknown positions are not rated', () => {
    const fb = sportConfig('football');
    const t = { games: 8, passing_attempts: 240 };
    expect(resolvePosition(fb, { athleteId: '1', rosterPositions: ['LB'], seasons: {} }, t, 8)).toEqual({ position: 'DEF', source: 'roster' });
    expect(resolvePosition(hockey, { athleteId: '1', rosterPositions: [], boxPositions: { G: 3, D: 1 }, seasons: {} }, {}, 4))
      .toEqual({ position: 'G', source: 'box' });
    expect(resolvePosition(fb, { athleteId: '1', rosterPositions: [], seasons: {} }, t, 8)).toEqual({ position: 'QB', source: 'inferred' });
    expect(resolvePosition(fb, { athleteId: '1', rosterPositions: ['K'], seasons: {} }, { games: 8, kicking_fg_made: 9 }, 8)).toBeNull();
    expect(resolvePosition(hockey, { athleteId: '1', rosterPositions: [], seasons: {} }, { games: 5, saves: 100 }, 5))
      .toEqual({ position: 'G', source: 'inferred' });
  });
});

describe('ratings track hidden talent on fake data', () => {
  const spearman = (a: number[], b: number[]) => {
    const ra = percentileRanks(a);
    const rb = percentileRanks(b);
    const ma = ra.reduce((s, x) => s + x, 0) / ra.length;
    const mb = rb.reduce((s, x) => s + x, 0) / rb.length;
    let num = 0, da = 0, dbb = 0;
    for (let i = 0; i < ra.length; i++) {
      num += (ra[i]! - ma) * (rb[i]! - mb);
      da += (ra[i]! - ma) ** 2;
      dbb += (rb[i]! - mb) ** 2;
    }
    return num / Math.sqrt(da * dbb);
  };

  it.each(['usports_mhk', 'usports_mbk', 'usports_msoc', 'usports_mvb', 'usports_fb'])('%s', (code) => {
    const data = generateFakeData({ seed: 99, teams: 12, sportCodes: [code] });
    const lines = new Map<string, Record<string, Record<string, number>>>();
    const season = new Map(data.games.map((g) => [g.key, g.season]));
    for (const l of data.lines) {
      const s = season.get(l.game)!;
      const p = lines.get(l.athlete) ?? {};
      const t = (p[s] ??= { games: 0 });
      t.games! += 1;
      for (const [k, x] of Object.entries(l.stats)) t[k] = (t[k] ?? 0) + x;
      lines.set(l.athlete, p);
    }
    const inputs: PlayerInput[] = data.athletes.map((a) => ({ athleteId: a.key, rosterPositions: a.positions, seasons: lines.get(a.key) ?? {} }));
    const ratings = computeRatings(sportConfig(BY_CODE[code]!.sport), inputs);
    const talent = new Map(data.athletes.map((a) => [a.key, a.talent]));
    const played = ratings.filter((r) => !r.isNew && r.gamesUsed >= 8);
    expect(played.length).toBeGreaterThan(30);
    expect(spearman(played.map((r) => r.ovr), played.map((r) => talent.get(r.athleteId)!))).toBeGreaterThan(0.5);
  });
});

describe('ratings job (database)', () => {
  let db: Db;
  beforeAll(() => { db = createPool(process.env.TEST_BATTLES_DATABASE_URL!, 3); });
  afterAll(() => db.end());

  it('rates every battle sport from 2025-26 onward and ignores older seasons', async () => {
    expect(await ratingSeasons(db)).toEqual(['2026-27', '2025-26']);
    // a monster pre-floor season must not count
    const { rows: [a] } = await db.query<{ id: string; university_id: string; sport_id: number }>(
      `SELECT a.id, a.university_id, a.sport_id FROM player_ratings pr JOIN athletes a ON a.id = pr.athlete_id
         JOIN sports s ON s.id = pr.sport_id WHERE s.code = 'usports_mhk' AND pr.position = 'F' ORDER BY pr.ovr LIMIT 1`);
    const before = (await db.query<{ ovr: number }>('SELECT ovr FROM player_ratings WHERE athlete_id = $1', [a!.id])).rows[0]!.ovr;
    const { rows: [opp] } = await db.query<{ id: string }>(`SELECT id FROM universities WHERE slug LIKE 'dev-%' AND id <> $1 LIMIT 1`, [a!.university_id]);
    const { rows: [g] } = await db.query<{ id: string }>(
      `INSERT INTO games (sport_id, source_game_id, season, season_segment, game_date, home_university_id, away_university_id, status, home_score, away_score)
       VALUES ($1, 'old-1', '2024-25', '2024-25', '2024-11-01', $2, $3, 'FINAL', 9, 0) RETURNING id`, [a!.sport_id, a!.university_id, opp!.id]);
    await db.query(`INSERT INTO game_stats (athlete_id, game_id, game_date, university_id, opponent_id, stat_payload_json)
                    VALUES ($1, $2, '2024-11-01', $3, $4, '{"goals":9,"assists":9,"shots":20}')`, [a!.id, g!.id, a!.university_id, opp!.id]);
    const inputs = await loadPlayerInputs(db, 'usports_mhk', await ratingSeasons(db));
    expect(Object.keys(inputs.find((p) => p.athleteId === a!.id)!.seasons)).not.toContain('2024-25');
    const run = await recomputeRatings(db);
    expect(run.skipped).toBeUndefined();
    const after = (await db.query<{ ovr: number }>('SELECT ovr FROM player_ratings WHERE athlete_id = $1', [a!.id])).rows[0]!.ovr;
    expect(after).toBe(before);
    await db.query('DELETE FROM games WHERE id = $1', [g!.id]);
  });

  it('stores a history row per recompute and skips when nothing changed', async () => {
    const { rows: [any] } = await db.query<{ athlete_id: string }>('SELECT athlete_id FROM player_ratings LIMIT 1');
    const count = async () => (await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM player_rating_history WHERE athlete_id = $1', [any!.athlete_id])).rows[0]!.n;
    const n0 = await count();
    await recomputeRatings(db, { force: true });
    expect(await count()).toBe(n0 + 1);
    expect((await recomputeRatings(db)).skipped).toBe('unchanged');
    expect(await count()).toBe(n0 + 1);
    const sports = (await db.query<{ code: string }>(
      `SELECT DISTINCT s.code FROM player_ratings pr JOIN sports s ON s.id = pr.sport_id ORDER BY 1`)).rows.map((r) => r.code);
    expect(sports).toEqual(['usports_fb', 'usports_mbk', 'usports_mhk', 'usports_msoc', 'usports_mvb',
      'usports_wbk', 'usports_whk', 'usports_wsoc', 'usports_wvb']);
  });
});
