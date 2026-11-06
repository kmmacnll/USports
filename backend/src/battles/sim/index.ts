/**
 * simulate(sport, lineupA, lineupB, seed) -> MatchResult
 *
 * Pure and deterministic: the same inputs and seed always give the same
 * match, event for event. Runs on the server only; clients receive events.
 */
import { createRng } from '../rng.js';
import type { BattleSport } from '../sports/types.js';
import type { Lineup, MatchResult } from '../types.js';
import { simulateBasketball } from './basketball.js';
import { simulateFootball } from './football.js';
import { simulateHockey } from './hockey.js';
import { simulateSoccer } from './soccer.js';
import { simulateVolleyball } from './volleyball.js';

const ENGINES = {
  hockey: simulateHockey,
  basketball: simulateBasketball,
  soccer: simulateSoccer,
  volleyball: simulateVolleyball,
  football: simulateFootball,
} as const;

export function simulate(sport: BattleSport, lineupA: Lineup, lineupB: Lineup, seed: number, matchId?: string): MatchResult {
  const engine = ENGINES[sport];
  if (!engine) throw new Error(`no simulation engine for ${sport}`);
  const s = seed >>> 0;
  return engine(lineupA, lineupB, createRng(s), s, matchId ?? `sim_${sport}_${s}`);
}

export type { Lineup, MatchEvent, MatchResult, SimPlayer } from '../types.js';
