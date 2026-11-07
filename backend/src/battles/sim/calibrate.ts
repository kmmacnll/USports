/**
 * Monte Carlo harness for tuning the engines (also used by the tests).
 *   npx tsx src/battles/sim/calibrate.ts [sport] [n]
 */
import { pathToFileURL } from 'node:url';

import { BATTLE_SPORTS, SPORTS } from '../sports/index.js';
import type { BattleSport } from '../sports/types.js';
import type { Lineup, SimPlayer } from '../types.js';
import { simulate } from './index.js';

/** A lineup whose every player has OVR and every sub-rating = `rating`. */
export function uniformLineup(sport: BattleSport, rating: number, name: string, prefix = name): Lineup {
  const cfg = SPORTS[sport];
  const players: SimPlayer[] = [];
  for (const slot of cfg.lineup) {
    for (let i = 0; i < slot.count; i++) {
      const subs = Object.keys(cfg.positions[slot.position]!.subRatings);
      players.push({ id: `${prefix}-${slot.slot}${i + 1}`, name: `${prefix}${slot.slot}${i + 1}`, position: slot.position, slot: slot.slot,
        ovr: rating, sub: Object.fromEntries(subs.map((k) => [k, rating])) });
    }
  }
  return { name, players };
}

export interface McStats {
  n: number;
  winA: number;
  ot: number;
  meanA: number;
  meanB: number;
  meanTotal: number;
  sdMargin: number;
  maxScore: number;
  meanEvents: number;
  minDuration: number;
  maxDuration: number;
  minRegDuration: number;
  maxRegDuration: number;
}

export function monteCarlo(sport: BattleSport, ratingA: number, ratingB: number, n: number, seed0 = 1): McStats {
  const A = uniformLineup(sport, ratingA, 'Alpha', 'a');
  const B = uniformLineup(sport, ratingB, 'Beta', 'b');
  let winA = 0, ot = 0, sa = 0, sb = 0, ev = 0, maxScore = 0;
  let minD = Infinity, maxD = 0, minR = Infinity, maxR = 0;
  const margins: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = simulate(sport, A, B, seed0 + i * 7919);
    if (r.winner === 'A') winA++;
    if (r.wentToOT) ot++;
    else { minR = Math.min(minR, r.durationMs); maxR = Math.max(maxR, r.durationMs); }
    sa += r.finalScoreA;
    sb += r.finalScoreB;
    maxScore = Math.max(maxScore, r.finalScoreA, r.finalScoreB);
    ev += r.events.length;
    margins.push(r.finalScoreA - r.finalScoreB);
    minD = Math.min(minD, r.durationMs);
    maxD = Math.max(maxD, r.durationMs);
  }
  const mm = margins.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(margins.reduce((s, x) => s + (x - mm) ** 2, 0) / n);
  return { n, winA: winA / n, ot: ot / n, meanA: sa / n, meanB: sb / n, meanTotal: (sa + sb) / n, sdMargin: sd, maxScore,
    meanEvents: ev / n, minDuration: minD, maxDuration: maxD, minRegDuration: minR, maxRegDuration: maxR };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sports = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2] as BattleSport] : BATTLE_SPORTS;
  const n = Number(process.argv[3] ?? 4000);
  for (const sport of sports) {
    for (const d of [0, 5, 10]) {
      const t0 = Date.now();
      const st = monteCarlo(sport, 70 + d, 70, n);
      console.log(`${sport.padEnd(10)} +${String(d).padEnd(2)} win ${(st.winA * 100).toFixed(1)}%  OT ${(st.ot * 100).toFixed(1)}%  ` +
        `score ${st.meanA.toFixed(1)}-${st.meanB.toFixed(1)} (max ${st.maxScore})  events ${st.meanEvents.toFixed(0)}  ` +
        `dur ${st.minDuration / 1000}-${st.maxDuration / 1000}s  ${Date.now() - t0}ms`);
    }
  }
}
