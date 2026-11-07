/**
 * The shape of a Draft Battles sport config. Everything sport-specific
 * (lineup, positions, how a position is inferred from stats, rating metrics
 * and weights, shrinkage k, simulation tuning, timing) lives in ONE file per
 * sport under src/battles/sports/, typed by this interface.
 */

export type BattleSport = 'hockey' | 'basketball' | 'soccer' | 'volleyball' | 'football';
export type Gender = 'MEN' | 'WOMEN';

/** Summed stat keys (stat_payload_json) over a set of games, plus:
 *  games, _team_for / _team_against (team score in those games), _scored_games. */
export type Totals = Record<string, number>;

export interface MetricDef {
  /** value = num(t) / den(t); undefined when den(t) <= 0 */
  num: (t: Totals) => number;
  den: (t: Totals) => number;
  /** Lower is better (goals against, turnovers...). Default false. */
  lowerIsBetter?: boolean;
}

export interface SubRatingDef {
  label: string;
  /** metric key -> weight. Percentiles of these metrics are combined. */
  metrics: Record<string, number>;
}

export interface PositionDef {
  label: string;
  /** Sub-rating key (e.g. SHT) -> definition. 4-6 per position. */
  subRatings: Record<string, SubRatingDef>;
  /** Sub-rating key -> weight in OVR (normalised by their sum). */
  ovrWeights: Record<string, number>;
}

export interface LineupSlot {
  /** Slot name used in picks (F, D, G, QB, DEF...). */
  slot: string;
  /** Battle position eligible for the slot. */
  position: string;
  count: number;
  label: string;
}

export interface BattleSportConfig<Sim = Record<string, number>> {
  sport: BattleSport;
  name: string;
  /** sports.code per gender (football is men only). */
  sportCodes: Partial<Record<Gender, string>>;
  lineup: LineupSlot[];
  positions: Record<string, PositionDef>;
  /** athletes.positions / game_stats.position token (upper-case) -> battle position. */
  positionMap: Record<string, string>;
  /** Fallback when no roster or box-score position maps: guess from stat totals.
   *  null = not a battle position (e.g. football kickers / linemen): not rated. */
  inferPosition: (t: Totals) => string | null;
  metrics: Record<string, MetricDef>;
  ratings: {
    /** Bayesian shrinkage strength, in games. */
    k: number;
  };
  sim: Sim;
  timing: {
    /** Real-time length of regulation, ms (120-180 s). */
    regulationMs: number;
    /** Real-time length of the overtime segment, ms (30-60 s). */
    overtimeMs: number;
  };
  /** In-game clock period labels, e.g. ["P1","P2","P3"]. */
  periods: string[];
}

// ------------------------------------------------------------------ helpers
export const v = (t: Totals, k: string): number => t[k] ?? 0;
/** stat per game */
export const perGame = (key: string, lowerIsBetter = false): MetricDef =>
  ({ num: (t) => v(t, key), den: (t) => v(t, 'games'), lowerIsBetter });
/** stat per `per` units of `denKey` (minutes, sets...), falls back to per game when denKey is absent. */
export const perUnit = (key: string, denKey: string, per: number, lowerIsBetter = false): MetricDef => ({
  num: (t) => v(t, key) * per,
  den: (t) => (v(t, denKey) > 0 ? v(t, denKey) : v(t, 'games') * per),
  lowerIsBetter,
});
export const ratio = (num: (t: Totals) => number, den: (t: Totals) => number, lowerIsBetter = false): MetricDef =>
  ({ num, den, lowerIsBetter });
export const rate = (t: Totals, key: string, per = 1): number => (v(t, 'games') > 0 ? (v(t, key) / v(t, 'games')) * per : 0);
