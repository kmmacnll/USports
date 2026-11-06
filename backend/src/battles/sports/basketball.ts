import { type BattleSportConfig, perUnit, ratio, v } from './types.js';

/**
 * Basketball (men's + women's), FIBA 4 x 10-minute quarters. Lineup 2 G, 2 F, 1 C.
 *
 * Positions come from roster pages; until those are reliable a position is
 * inferred from the stat profile (inferPosition). If that proves too noisy,
 * set ANY_POSITION = true: the lineup becomes 5 x UTIL (any player).
 */
export const ANY_POSITION = false;

export interface BasketballSim {
  /** game seconds per possession: uniform in [min, max] */
  possessionMin: number;
  possessionMax: number;
  turnoverBase: number;
  threeShare: number;
  twoBase: number;
  threeBase: number;
  foulRate: number;
  freeThrowBase: number;
  offRebBase: number;
  /** logistic slope per rating point */
  sensitivity: number;
  otSeconds: number;
}

const per40 = (key: string, lower = false) => perUnit(key, 'minutes', 40, lower);

const POSITIONAL = [
  { slot: 'G', position: 'G', count: 2, label: 'Guard' },
  { slot: 'F', position: 'F', count: 2, label: 'Forward' },
  { slot: 'C', position: 'C', count: 1, label: 'Centre' },
];
const UTIL = [{ slot: 'UTIL', position: 'UTIL', count: 5, label: 'Any position' }];

const subRatings = {
  SCO: { label: 'Scoring', metrics: { pts_per40: 0.5, ts_pct: 0.5 } },
  '3PT': { label: '3-point shooting', metrics: { threes_per40: 0.5, three_pct: 0.5 } },
  PLY: { label: 'Playmaking', metrics: { ast_per40: 0.6, ast_to: 0.4 } },
  REB: { label: 'Rebounding', metrics: { reb_per40: 0.7, oreb_per40: 0.3 } },
  DEF: { label: 'Defence', metrics: { stl_per40: 0.35, blk_per40: 0.35, team_pa_pg: 0.3 } },
};

export const basketball: BattleSportConfig<BasketballSim> = {
  sport: 'basketball',
  name: 'Basketball',
  sportCodes: { MEN: 'usports_mbk', WOMEN: 'usports_wbk' },
  lineup: ANY_POSITION ? UTIL : POSITIONAL,
  positionMap: ANY_POSITION
    ? { G: 'UTIL', PG: 'UTIL', SG: 'UTIL', F: 'UTIL', SF: 'UTIL', PF: 'UTIL', C: 'UTIL' }
    : { G: 'G', PG: 'G', SG: 'G', F: 'F', SF: 'F', PF: 'F', C: 'C' },
  inferPosition: (t) => {
    if (ANY_POSITION) return 'UTIL';
    const min = v(t, 'minutes') || v(t, 'games') * 20;
    const p40 = (k: string) => (min > 0 ? (v(t, k) * 40) / min : 0);
    const fga = v(t, 'field_goals_attempted');
    const threeShare = fga > 0 ? v(t, 'three_pointers_attempted') / fga : 0;
    if (p40('blocks') >= 1.5 || (p40('rebounds') >= 10 && threeShare < 0.1)) return 'C';
    if (p40('assists') >= 4 || (threeShare >= 0.4 && p40('rebounds') < 7)) return 'G';
    return 'F';
  },
  metrics: {
    pts_per40: per40('points'),
    ts_pct: ratio((t) => v(t, 'points'),
      (t) => 2 * (v(t, 'field_goals_attempted') + 0.44 * v(t, 'free_throws_attempted'))),
    threes_per40: per40('three_pointers_made'),
    three_pct: ratio((t) => v(t, 'three_pointers_made'), (t) => v(t, 'three_pointers_attempted')),
    ast_per40: per40('assists'),
    ast_to: ratio((t) => v(t, 'assists'), (t) => v(t, 'turnovers') + 1),
    reb_per40: per40('rebounds'),
    oreb_per40: per40('offensive_rebounds'),
    stl_per40: per40('steals'),
    blk_per40: per40('blocks'),
    team_pa_pg: ratio((t) => v(t, '_team_against'), (t) => v(t, '_scored_games'), true),
  },
  positions: ANY_POSITION
    ? { UTIL: { label: 'Player', subRatings, ovrWeights: { SCO: 0.3, '3PT': 0.15, PLY: 0.2, REB: 0.15, DEF: 0.2 } } }
    : {
        G: { label: 'Guard', subRatings, ovrWeights: { SCO: 0.3, '3PT': 0.2, PLY: 0.3, REB: 0.05, DEF: 0.15 } },
        F: { label: 'Forward', subRatings, ovrWeights: { SCO: 0.3, '3PT': 0.15, PLY: 0.15, REB: 0.2, DEF: 0.2 } },
        C: { label: 'Centre', subRatings, ovrWeights: { SCO: 0.3, '3PT': 0.05, PLY: 0.1, REB: 0.3, DEF: 0.25 } },
      },
  ratings: { k: 6 },
  sim: {
    possessionMin: 10,
    possessionMax: 24,
    turnoverBase: 0.14,
    threeShare: 0.36,
    twoBase: 0.5,
    threeBase: 0.33,
    foulRate: 0.11,
    freeThrowBase: 0.72,
    offRebBase: 0.27,
    sensitivity: 0.012,
    otSeconds: 300,
  },
  timing: { regulationMs: 160_000, overtimeMs: 45_000 },
  periods: ['Q1', 'Q2', 'Q3', 'Q4'],
};
