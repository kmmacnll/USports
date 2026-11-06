/**
 * Snake-draft rules, pure. A battle's draft is 2 x lineup-size picks from one
 * shared pool; picks alternate A B B A A B ... starting with the coin-flip
 * winner; each pick must fill an open lineup slot of the picker's side.
 */
import { SPORTS } from './sports/index.js';
import type { BattleSport } from './sports/types.js';
import type { Side } from './types.js';

export const totalPicks = (sport: BattleSport) => 2 * SPORTS[sport].lineup.reduce((n, s) => n + s.count, 0);

/** Side making pick number `n` (0-based). */
export function sideForPick(first: Side, n: number): Side {
  const round = Math.floor(n / 2);
  const firstInPair = n % 2 === 0;
  const leads = round % 2 === 0 ? first : first === 'A' ? 'B' : 'A';
  return firstInPair ? leads : leads === 'A' ? 'B' : 'A';
}

export function pickOrder(first: Side, sport: BattleSport): Side[] {
  return Array.from({ length: totalPicks(sport) }, (_, i) => sideForPick(first, i));
}

/** slot -> remaining count for one side, given the slots it already filled. */
export function openSlots(sport: BattleSport, filled: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SPORTS[sport].lineup) out[s.slot] = s.count;
  for (const f of filled) if (out[f] !== undefined) out[f]! -= 1;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0));
}

/** The slot a player of battle position `position` would fill, or null. */
export function slotFor(sport: BattleSport, filled: string[], position: string): string | null {
  const open = openSlots(sport, filled);
  const slot = SPORTS[sport].lineup.find((s) => s.position === position && open[s.slot]);
  return slot?.slot ?? null;
}

/** Positions that can still be picked by this side. */
export const openPositions = (sport: BattleSport, filled: string[]) =>
  [...new Set(SPORTS[sport].lineup.filter((s) => openSlots(sport, filled)[s.slot]).map((s) => s.position))];

export interface PoolPlayer { athleteId: string; position: string; ovr: number }

/** Best available eligible player: highest OVR that fits an open slot (ties: lowest id, for determinism). */
export function bestAvailable(sport: BattleSport, pool: PoolPlayer[], taken: Set<string>, filled: string[]): PoolPlayer | null {
  const positions = new Set(openPositions(sport, filled));
  let best: PoolPlayer | null = null;
  for (const p of pool) {
    if (taken.has(p.athleteId) || !positions.has(p.position)) continue;
    if (!best || p.ovr > best.ovr || (p.ovr === best.ovr && Number(p.athleteId) < Number(best.athleteId))) best = p;
  }
  return best;
}
