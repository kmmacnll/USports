import { basketball } from './basketball.js';
import { football } from './football.js';
import { hockey } from './hockey.js';
import { soccer } from './soccer.js';
import type { BattleSport, BattleSportConfig, Gender } from './types.js';
import { volleyball } from './volleyball.js';

export * from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each sport has its own Sim type
export const SPORTS = { hockey, basketball, soccer, volleyball, football } as const satisfies Record<BattleSport, BattleSportConfig<any>>;
export const BATTLE_SPORTS = Object.keys(SPORTS) as BattleSport[];

export function sportConfig(sport: BattleSport): BattleSportConfig<unknown> {
  return SPORTS[sport] as BattleSportConfig<unknown>;
}

/** sports.code (usports_mhk) -> { sport, gender }, for every code a battle sport covers. */
export const BY_CODE: Record<string, { sport: BattleSport; gender: Gender }> = Object.fromEntries(
  BATTLE_SPORTS.flatMap((sport) => Object.entries(SPORTS[sport].sportCodes)
    .map(([gender, code]) => [code, { sport, gender: gender as Gender }])),
);
export const BATTLE_SPORT_CODES = Object.keys(BY_CODE);

export function codeFor(sport: BattleSport, gender: Gender): string | undefined {
  return SPORTS[sport].sportCodes[gender];
}

/** Lineup size (players per side). */
export const lineupSize = (sport: BattleSport) => SPORTS[sport].lineup.reduce((n, s) => n + s.count, 0);
