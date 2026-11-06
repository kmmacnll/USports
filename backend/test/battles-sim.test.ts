import { describe, expect, it } from 'vitest';

import { monteCarlo, uniformLineup } from '../src/battles/sim/calibrate.js';
import { simulate } from '../src/battles/sim/index.js';
import { BATTLE_SPORTS, SPORTS } from '../src/battles/sports/index.js';
import type { BattleSport } from '../src/battles/sports/types.js';
import type { Lineup, MatchResult } from '../src/battles/types.js';

const EVENT_TYPES = new Set(['goal', 'point', 'shot', 'save', 'turnover', 'foul', 'penalty', 'sub', 'period_start', 'period_end',
  'ot_start', 'final', 'highlight']);

/** A realistic, uneven lineup: ratings spread around `mean`. */
function mixedLineup(sport: BattleSport, mean: number, name: string, prefix: string): Lineup {
  const l = uniformLineup(sport, mean, name, prefix);
  l.players.forEach((p, i) => {
    const d = ((i * 37) % 11) - 5;
    p.ovr = mean + d;
    for (const k of Object.keys(p.sub)) p.sub[k] = Math.max(40, Math.min(99, mean + d + ((k.charCodeAt(0) * 13 + i) % 9) - 4));
  });
  return l;
}

/** Monte Carlo realism targets (10,000 matches per sport and condition). */
const SCORE_BANDS: Record<BattleSport, { meanTeam: [number, number]; maxTeam: number }> = {
  hockey: { meanTeam: [2.2, 3.8], maxTeam: 16 },
  basketball: { meanTeam: [62, 88], maxTeam: 135 },
  soccer: { meanTeam: [0.9, 2.0], maxTeam: 10 },
  volleyball: { meanTeam: [1.4, 2.6], maxTeam: 3 },     // sets won
  football: { meanTeam: [17, 32], maxTeam: 80 },
};

describe('Monte Carlo: win rates and score distributions (10,000 sims per sport and condition)', () => {
  it.each(BATTLE_SPORTS)('%s', (sport) => {
    const even = monteCarlo(sport, 70, 70, 10_000, 11);
    const plus5 = monteCarlo(sport, 75, 70, 10_000, 22);
    const plus10 = monteCarlo(sport, 80, 70, 10_000, 33);
    // equal lineups: a coin flip
    expect(even.winA).toBeGreaterThan(0.47);
    expect(even.winA).toBeLessThan(0.53);
    // +5 average OVR ~62-68%, +10 ~75-80%
    expect(plus5.winA).toBeGreaterThanOrEqual(0.62);
    expect(plus5.winA).toBeLessThanOrEqual(0.68);
    expect(plus10.winA).toBeGreaterThanOrEqual(0.75);
    expect(plus10.winA).toBeLessThanOrEqual(0.8);
    // upsets happen
    expect(1 - plus10.winA).toBeGreaterThan(0.18);
    // realistic scores
    const band = SCORE_BANDS[sport];
    const meanTeam = even.meanTotal / 2;
    expect(meanTeam).toBeGreaterThanOrEqual(band.meanTeam[0]);
    expect(meanTeam).toBeLessThanOrEqual(band.meanTeam[1]);
    expect(Math.max(even.maxScore, plus10.maxScore)).toBeLessThanOrEqual(band.maxTeam);
    expect(plus10.meanA).toBeGreaterThan(plus10.meanB);
    // overtime is needed sometimes, but not usually (volleyball: a fifth set)
    expect(even.ot).toBeGreaterThan(0.01);
    expect(even.ot).toBeLessThan(0.4);
    // playback: regulation 120-180 s, overtime adds 30-60 s
    const reg = SPORTS[sport].timing.regulationMs;
    expect(reg).toBeGreaterThanOrEqual(120_000);
    expect(reg).toBeLessThanOrEqual(180_000);
    for (const st of [even, plus5, plus10]) {
      expect(st.minRegDuration).toBe(reg);
      expect(st.maxRegDuration).toBe(reg);
      expect(st.maxDuration - reg).toBeLessThanOrEqual(60_000);
    }
  }, 120_000);

  it('a mixed lineup with a +5 average beats one with a +0 average about as often', () => {
    let wins = 0;
    const n = 4000;
    const A = mixedLineup('hockey', 75, 'A', 'a');
    const B = mixedLineup('hockey', 70, 'B', 'b');
    for (let i = 0; i < n; i++) if (simulate('hockey', A, B, 1000 + i).winner === 'A') wins++;
    expect(wins / n).toBeGreaterThan(0.58);
    expect(wins / n).toBeLessThan(0.74);
  }, 60_000);
});

function checkResult(r: MatchResult, A: Lineup, B: Lineup) {
  const ids = new Set([...A.players, ...B.players].map((p) => p.id));
  const reg = SPORTS[r.sport].timing.regulationMs;
  expect(r.events.length).toBeGreaterThan(10);
  let prev = -1;
  let sa = 0;
  let sb = 0;
  for (const e of r.events) {
    expect(EVENT_TYPES.has(e.type), e.type).toBe(true);
    expect(e.t).toBeGreaterThanOrEqual(prev);
    prev = e.t;
    expect(typeof e.period).toBe('string');
    expect(typeof e.clock).toBe('string');
    expect(e.text.length).toBeGreaterThan(3);
    expect(e.momentum).toBeGreaterThanOrEqual(-1);
    expect(e.momentum).toBeLessThanOrEqual(1);
    expect([null, 'A', 'B']).toContain(e.side);
    for (const id of e.playerIds) expect(ids.has(id), id).toBe(true);
    expect(e.scoreA).toBeGreaterThanOrEqual(sa);
    expect(e.scoreB).toBeGreaterThanOrEqual(sb);
    sa = e.scoreA;
    sb = e.scoreB;
  }
  const last = r.events[r.events.length - 1]!;
  expect(last.type).toBe('final');
  expect(r.events.filter((e) => e.type === 'final')).toHaveLength(1);
  expect(last.t).toBe(r.durationMs);
  expect([last.scoreA, last.scoreB]).toEqual([r.finalScoreA, r.finalScoreB]);
  expect(r.durationMs).toBe(r.wentToOT ? r.durationMs : reg);
  if (r.wentToOT) {
    expect(r.durationMs - reg).toBeGreaterThanOrEqual(30_000);
    expect(r.durationMs - reg).toBeLessThanOrEqual(60_000);
    expect(r.events.some((e) => e.type === 'ot_start')).toBe(true);
  } else {
    expect(r.events.some((e) => e.type === 'ot_start')).toBe(false);
  }
  if (r.finalScoreA !== r.finalScoreB) expect(r.winner).toBe(r.finalScoreA > r.finalScoreB ? 'A' : 'B');
}

describe('simulate()', () => {
  it.each(BATTLE_SPORTS)('%s is deterministic: same seed, same match', (sport) => {
    const A = mixedLineup(sport, 74, 'Gaels', 'a');
    const B = mixedLineup(sport, 72, 'Rams', 'b');
    const r1 = simulate(sport, A, B, 123456);
    const r2 = simulate(sport, A, B, 123456);
    expect(r2).toEqual(r1);
    expect(r1.seed).toBe(123456);
    const other = simulate(sport, A, B, 654321);
    expect(other.events.map((e) => e.text)).not.toEqual(r1.events.map((e) => e.text));
  });

  it.each(BATTLE_SPORTS)('%s events follow the shared schema, name drafted players, and fit the timing', (sport) => {
    const A = mixedLineup(sport, 74, 'Gaels', 'a');
    const B = mixedLineup(sport, 72, 'Rams', 'b');
    for (let seed = 1; seed <= 200; seed++) checkResult(simulate(sport, A, B, seed), A, B);
    const r = simulate(sport, A, B, 7);
    const named = r.events.filter((e) => e.playerIds.length > 0);
    expect(named.length).toBeGreaterThan(5);
    const p = [...A.players, ...B.players].find((x) => x.id === named[0]!.playerIds[0])!;
    expect(named[0]!.text).toContain(p.name);
  });

  it('play-by-play never goes quiet for long', () => {
    for (const sport of BATTLE_SPORTS) {
      for (let seed = 1; seed <= 100; seed++) {
        const r = simulate(sport, uniformLineup(sport, 72, 'A'), uniformLineup(sport, 70, 'B'), seed);
        for (let i = 1; i < r.events.length; i++) expect(r.events[i]!.t - r.events[i - 1]!.t, `${sport} ${seed}`).toBeLessThanOrEqual(10_000);
      }
    }
  }, 60_000);
});

describe('overtime rules', () => {
  const findOT = (sport: BattleSport, pred: (r: MatchResult) => boolean) => {
    const A = uniformLineup(sport, 70, 'A');
    const B = uniformLineup(sport, 70, 'B');
    for (let seed = 1; seed < 20_000; seed++) {
      const r = simulate(sport, A, B, seed);
      if (r.wentToOT && pred(r)) return r;
    }
    throw new Error(`no ${sport} overtime found`);
  };

  it('hockey: 3-on-3 sudden death, then a shootout worth one goal', () => {
    const sd = findOT('hockey', (r) => !r.events.some((e) => e.period === 'SO'));
    expect(Math.abs(sd.finalScoreA - sd.finalScoreB)).toBe(1);
    const ot = sd.events.filter((e) => e.period === 'OT' && e.type === 'goal');
    expect(ot).toHaveLength(1);                                         // sudden death: one goal ends it
    expect(sd.events.find((e) => e.type === 'ot_start')!.text).toMatch(/3-on-3/);
    const so = findOT('hockey', (r) => r.events.some((e) => e.period === 'SO'));
    expect(Math.abs(so.finalScoreA - so.finalScoreB)).toBe(1);
    expect(so.events.filter((e) => e.period === 'OT' && e.type === 'goal')).toHaveLength(0);
  });

  it('basketball: overtime periods until someone wins', () => {
    const r = findOT('basketball', () => true);
    expect(r.finalScoreA).not.toBe(r.finalScoreB);
    expect(r.events.some((e) => /OT$/.test(e.period))).toBe(true);
  });

  it('soccer: golden goal, then penalties (score stays level, winner on penalties)', () => {
    const gg = findOT('soccer', (r) => r.finalScoreA !== r.finalScoreB);
    expect(gg.events.filter((e) => e.period === 'OT' && e.type === 'goal')).toHaveLength(1);
    const pk = findOT('soccer', (r) => r.finalScoreA === r.finalScoreB);
    expect(pk.events.some((e) => e.period === 'PK')).toBe(true);
    expect(pk.events[pk.events.length - 1]!.text).toMatch(/on penalties/);
    expect(['A', 'B']).toContain(pk.winner);
  });

  it('volleyball: no overtime, a fifth set to 15 is the overtime segment', () => {
    const five = findOT('volleyball', () => true);
    expect(five.events.some((e) => e.period === 'SET5')).toBe(true);
    expect(Math.max(five.finalScoreA, five.finalScoreB)).toBe(3);
    expect(Math.min(five.finalScoreA, five.finalScoreB)).toBe(2);
    const A = uniformLineup('volleyball', 70, 'A');
    for (let seed = 1; seed <= 300; seed++) {
      const r = simulate('volleyball', A, uniformLineup('volleyball', 70, 'B'), seed);
      expect(Math.max(r.finalScoreA, r.finalScoreB)).toBe(3);
      expect(r.wentToOT).toBe(r.finalScoreA + r.finalScoreB === 5);
    }
  });

  it('football: alternating possessions until one side leads after a round', () => {
    const r = findOT('football', () => true);
    expect(r.finalScoreA).not.toBe(r.finalScoreB);
    expect(r.events.some((e) => e.period === 'OT' && e.type === 'goal')).toBe(true);
  });
});
