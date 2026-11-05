/**
 * Per-sport presentation of season stats: maps short public keys
 * (ppg, rpg, ...) to the per-game averages of canonical stat keys written by
 * the pipeline (game_stats.raw_stats_json). Sports without an entry return
 * every averaged stat under its canonical key.
 */
const BASKETBALL = {
  ppg: 'points',
  rpg: 'rebounds',
  apg: 'assists',
  spg: 'steals',
  bpg: 'blocks',
  tpg: 'turnovers',
  mpg: 'minutes',
} as const;

const FOOTBALL = {
  pass_ypg: 'passing_yards',
  pass_tdpg: 'passing_touchdown',
  rush_ypg: 'rushing_yards',
  rush_tdpg: 'rushing_touchdown',
  rec_pg: 'receiving_receptions',
  rec_ypg: 'receiving_yards',
  rec_tdpg: 'receiving_touchdown',
  fgm_pg: 'kicking_fg_made',
  tackles_pg: 'defence_tackles',
  sacks_pg: 'defence_sacks',
} as const;

export interface StatColumn {
  key: string;
  label: string;
}

/** Season columns (keys of athlete.stats) and per-game columns (keys of raw stats) shown in UIs. */
export const STAT_COLUMNS: Record<string, { season: StatColumn[]; game: StatColumn[] }> = {
  basketball: {
    season: [
      { key: 'ppg', label: 'PPG' }, { key: 'rpg', label: 'RPG' }, { key: 'apg', label: 'APG' },
      { key: 'spg', label: 'SPG' }, { key: 'bpg', label: 'BPG' }, { key: 'mpg', label: 'MIN' },
    ],
    game: [
      { key: 'minutes', label: 'MIN' }, { key: 'points', label: 'PTS' }, { key: 'rebounds', label: 'REB' },
      { key: 'assists', label: 'AST' }, { key: 'steals', label: 'STL' }, { key: 'blocks', label: 'BLK' },
      { key: 'turnovers', label: 'TO' },
    ],
  },
  football: {
    season: [
      { key: 'pass_ypg', label: 'PASS YPG' }, { key: 'rush_ypg', label: 'RUSH YPG' },
      { key: 'rec_ypg', label: 'REC YPG' }, { key: 'rec_pg', label: 'REC/G' }, { key: 'tackles_pg', label: 'TKL/G' },
    ],
    game: [
      { key: 'passing_yards', label: 'PASS' }, { key: 'passing_touchdown', label: 'P TD' },
      { key: 'rushing_yards', label: 'RUSH' }, { key: 'rushing_touchdown', label: 'R TD' },
      { key: 'receiving_receptions', label: 'REC' }, { key: 'receiving_yards', label: 'REC YD' },
      { key: 'kicking_fg_made', label: 'FGM' }, { key: 'defence_tackles', label: 'TKL' },
    ],
  },
};

const COLUMN_SET: Record<string, keyof typeof STAT_COLUMNS> = {
  usports_mbk: 'basketball',
  usports_wbk: 'basketball',
  usports_fb: 'football',
};

export function statColumns(sportCode: string): { season: StatColumn[]; game: StatColumn[] } {
  const set = COLUMN_SET[sportCode];
  return set ? STAT_COLUMNS[set]! : { season: [], game: [] };
}

export const STAT_SUMMARY: Record<string, Record<string, string>> = {
  usports_mbk: BASKETBALL,
  usports_wbk: BASKETBALL,
  usports_fb: FOOTBALL,
};

export function summarizeStats(sportCode: string, averages: Record<string, number> | null): Record<string, number> {
  const avg = averages ?? {};
  const map = STAT_SUMMARY[sportCode];
  if (!map) return { ...avg };
  const out: Record<string, number> = {};
  for (const [publicKey, statKey] of Object.entries(map)) {
    const v = avg[statKey];
    if (v !== undefined) out[publicKey] = Number(v);
  }
  return out;
}

const NON_STARTER = ['BENCH', 'IR'];

/** Roster slot keys in display order: slot_order first, then any others, BENCH and IR last. */
export function orderSlots(limits: Record<string, number>, slotOrder: string[] | undefined): string[] {
  const keys = Object.keys(limits);
  const ordered = (slotOrder ?? []).filter((k) => keys.includes(k) && !NON_STARTER.includes(k));
  const rest = keys.filter((k) => !ordered.includes(k) && !NON_STARTER.includes(k)).sort();
  return [...ordered, ...rest, ...NON_STARTER.filter((k) => keys.includes(k))];
}

export function orderedLimits(limits: Record<string, number>, slotOrder: string[] | undefined): Record<string, number> {
  return Object.fromEntries(orderSlots(limits, slotOrder).map((k) => [k, limits[k] ?? 0]));
}

/** {"PG":1,"BENCH":2} -> ["PG","BENCH","BENCH"] */
export function expandPositions(limits: Record<string, number>, slotOrder: string[] | undefined): string[] {
  return orderSlots(limits, slotOrder).flatMap((k) => Array<string>(limits[k] ?? 0).fill(k));
}

export function isStarterSlot(slot: string): boolean {
  return !NON_STARTER.includes(slot);
}

/** Mirrors the roster_spots trigger, so the API can pick a slot before writing. */
export function isEligible(slot: string, positions: string[], eligibility: Record<string, string[]> | undefined): boolean {
  if (!isStarterSlot(slot)) return true;
  const allowed = [...(eligibility?.[slot] ?? []), slot];
  return positions.some((p) => allowed.includes(p));
}

export function currentSeason(today = new Date()): string {
  const y = today.getUTCFullYear();
  const start = today.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
