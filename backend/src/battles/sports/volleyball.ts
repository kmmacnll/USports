import { type BattleSportConfig, perUnit, ratio, v } from './types.js';

/**
 * Volleyball (men's + women's), best of 5 sets. Lineup 1 S, 2 OH, 1 MB, 1 OPP, 1 L.
 * Rates are per set played. The feed publishes no positions, so until roster
 * positions are synced they are inferred from the stat profile.
 */
export interface VolleyballSim {
  aceBase: number;
  serveErrorBase: number;
  killBase: number;
  blockBase: number;
  attackErrorBase: number;
  sensitivity: number;
  /** attacker selection weights by position */
  attackShare: Record<string, number>;
}

const perSet = (key: string, lower = false) => perUnit(key, 'sets_played', 1, lower);

const subRatings = {
  ATK: { label: 'Attack', metrics: { kills_ps: 0.6, hit_eff: 0.4 } },
  SRV: { label: 'Serve', metrics: { aces_ps: 0.7, serve_err_ps: 0.3 } },
  BLK: { label: 'Block', metrics: { blocks_ps: 1 } },
  DIG: { label: 'Dig / reception', metrics: { digs_ps: 0.7, rec_err_ps: 0.3 } },
  SET: { label: 'Setting', metrics: { assists_ps: 0.8, bhe_ps: 0.2 } },
};

export const volleyball: BattleSportConfig<VolleyballSim> = {
  sport: 'volleyball',
  name: 'Volleyball',
  sportCodes: { MEN: 'usports_mvb', WOMEN: 'usports_wvb' },
  lineup: [
    { slot: 'S', position: 'S', count: 1, label: 'Setter' },
    { slot: 'OH', position: 'OH', count: 2, label: 'Outside hitter' },
    { slot: 'MB', position: 'MB', count: 1, label: 'Middle blocker' },
    { slot: 'OPP', position: 'OPP', count: 1, label: 'Opposite' },
    { slot: 'L', position: 'L', count: 1, label: 'Libero' },
  ],
  positionMap: {
    S: 'S', SETTER: 'S', OH: 'OH', LS: 'OH', OUTSIDE: 'OH', H: 'OH', MB: 'MB', M: 'MB', MIDDLE: 'MB',
    OPP: 'OPP', OP: 'OPP', RS: 'OPP', RIGHT: 'OPP', L: 'L', LIB: 'L', LIBERO: 'L', DS: 'L',
  },
  inferPosition: (t) => {
    const sets = v(t, 'sets_played') || v(t, 'games') * 3;
    const ps = (k: string) => (sets > 0 ? v(t, k) / sets : 0);
    const blocks = ps('block_solos') + 0.5 * ps('block_assists');
    if (ps('assists') >= 4) return 'S';
    if (ps('total_attacks') < 0.6 && ps('digs') >= 1.2) return 'L';
    if (blocks >= 0.5 && ps('digs') < 1.0) return 'MB';
    if (ps('digs') >= 1.4) return 'OH';
    if (ps('kills') >= 1.5) return 'OPP';
    return 'OH';
  },
  metrics: {
    kills_ps: perSet('kills'),
    hit_eff: ratio((t) => v(t, 'kills') - v(t, 'attack_errors'), (t) => v(t, 'total_attacks')),
    aces_ps: perSet('service_aces'),
    serve_err_ps: perSet('service_errors', true),
    blocks_ps: ratio((t) => v(t, 'block_solos') + 0.5 * v(t, 'block_assists'), (t) => v(t, 'sets_played') || v(t, 'games') * 3),
    digs_ps: perSet('digs'),
    rec_err_ps: perSet('reception_errors', true),
    assists_ps: perSet('assists'),
    bhe_ps: perSet('ball_handling_errors', true),
  },
  positions: {
    S: { label: 'Setter', subRatings, ovrWeights: { SET: 0.55, SRV: 0.15, DIG: 0.15, BLK: 0.1, ATK: 0.05 } },
    OH: { label: 'Outside hitter', subRatings, ovrWeights: { ATK: 0.4, DIG: 0.2, SRV: 0.15, BLK: 0.15, SET: 0.1 } },
    MB: { label: 'Middle blocker', subRatings, ovrWeights: { BLK: 0.45, ATK: 0.35, SRV: 0.15, DIG: 0.05 } },
    OPP: { label: 'Opposite', subRatings, ovrWeights: { ATK: 0.5, BLK: 0.25, SRV: 0.15, DIG: 0.1 } },
    L: { label: 'Libero', subRatings, ovrWeights: { DIG: 0.75, SET: 0.15, SRV: 0.1 } },
  },
  ratings: { k: 6 },
  sim: {
    aceBase: 0.065,
    serveErrorBase: 0.1,
    killBase: 0.44,
    blockBase: 0.09,
    attackErrorBase: 0.08,
    sensitivity: 0.0084,
    attackShare: { OH: 0.34, OPP: 0.22, MB: 0.1, S: 0.0 },
  },
  timing: { regulationMs: 150_000, overtimeMs: 40_000 },
  periods: ['SET1', 'SET2', 'SET3', 'SET4', 'SET5'],
};
