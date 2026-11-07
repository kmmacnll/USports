/**
 * Player overall ratings (OVR 40-99) and sub-ratings. Pure functions: the DB
 * job (job.ts) loads stat totals, calls computeRatings(), and stores the result.
 *
 * Method, per sport (sport code = sport + gender) and battle position:
 *  1. Stats are summed per season; rate metrics are num/den over those sums
 *     (per game, per 40 min, per set, per 90 min, percentages).
 *  2. Recency: each season's totals are scaled by its weight (current 0.65,
 *     previous 0.35) before summing, so the weighting is also by games played.
 *  3. Bayesian shrinkage toward the position baseline (pooled rate of the
 *     position group): (n·x + k·baseline) / (n + k), n = qualifying games.
 *     Ratings are rank-based, so shrinking the rate alone can't stop a tiny
 *     sample from ranking first if its shrunk rate still beats everyone. The
 *     composite percentiles are therefore also pulled toward the middle by the
 *     same reliability, n / (n + k), before they are re-ranked.
 *  4. No qualifying games: baseline OVR (60) for everything, flagged NEW.
 *  5. Each metric becomes a percentile within sport + gender + position. A
 *     sub-rating is the weighted mean of its metrics' percentiles, re-ranked
 *     as a percentile and mapped through the calibration curve. OVR is the
 *     position-weighted mean of the sub-rating percentiles, re-ranked and
 *     mapped the same way.
 *  6. The curve (config.ts) puts the floor at 40, the median at 68, the top
 *     10% at >= 80 and the top 1% at >= 88.
 */
import { BATTLES } from '../config.js';
import type { BattleSportConfig, Totals } from '../sports/types.js';

export interface PlayerInput {
  athleteId: string;
  /** athletes.positions (normalised roster tokens) */
  rosterPositions: string[];
  /** athletes.position (raw), used when tokens are empty */
  rawPosition?: string | null;
  /** count of games per raw box-score position (game_stats.position) */
  boxPositions?: Record<string, number>;
  /** season label -> summed stats (incl. games, _team_for, _team_against, _scored_games) */
  seasons: Record<string, Totals>;
}

export type PositionSource = 'roster' | 'box' | 'inferred';

export interface PlayerRating {
  athleteId: string;
  position: string;
  positionSource: PositionSource;
  ovr: number;
  subRatings: Record<string, number>;
  gamesUsed: number;
  isNew: boolean;
}

export interface RatingOptions {
  /** seasons in use, newest first; defaults to the input's seasons sorted desc */
  seasons?: string[];
  seasonWeights?: readonly number[];
  calibration?: ReadonlyArray<readonly [number, number]>;
  baselineOvr?: number;
}

// ------------------------------------------------------------------ building blocks

/** Bayesian shrinkage of an observed rate toward a baseline, with strength k games. */
export function shrink(value: number, games: number, baseline: number, k: number): number {
  if (games <= 0) return baseline;
  return (games * value + k * baseline) / (games + k);
}

/** Reliability of a sample of n games with shrinkage strength k: n / (n + k). */
export const reliability = (games: number, k: number) => (games <= 0 ? 0 : games / (games + k));

/** Pull a percentile toward the median by reliability r. */
export const shrinkPercentile = (p: number, r: number) => 0.5 + r * (p - 0.5);

/** Mid-rank percentiles in (0,1): ties share the average rank. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const idx = values.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j++;
    const mid = (i + j) / 2 + 0.5;          // 1-based average rank minus 0.5
    for (let m = i; m <= j; m++) out[idx[m]![1]] = mid / n;
    i = j + 1;
  }
  return out;
}

/** Piecewise-linear percentile -> rating. */
export function calibrate(p: number, curve: ReadonlyArray<readonly [number, number]> = BATTLES.ratings.calibration): number {
  const x = Math.min(1, Math.max(0, p));
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1]!;
    const [x1, y1] = curve[i]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0 || 1)) * (y1 - y0);
  }
  return curve[curve.length - 1]![1];
}

export const toRating = (x: number) =>
  Math.min(BATTLES.ratings.max, Math.max(BATTLES.ratings.min, Math.round(x)));

/** Weighted mean of `values` by `weights` (keys missing from values are skipped). */
export function weightedMean(values: Record<string, number>, weights: Record<string, number>): number {
  let s = 0;
  let w = 0;
  for (const [k, wt] of Object.entries(weights)) {
    const x = values[k];
    if (x === undefined || !Number.isFinite(x)) continue;
    s += wt * x;
    w += wt;
  }
  return w > 0 ? s / w : 0;
}

/** Recency-weighted totals: Σ_s weight_s · totals_s. Seasons beyond the weights list get 0. */
export function weightedTotals(seasons: Record<string, Totals>, order: string[], weights: readonly number[]): Totals {
  const out: Totals = {};
  order.forEach((season, i) => {
    const w = weights[i] ?? 0;
    const t = seasons[season];
    if (!t || w === 0) return;
    for (const [k, x] of Object.entries(t)) out[k] = (out[k] ?? 0) + w * x;
  });
  return out;
}

export function qualifyingGames(seasons: Record<string, Totals>, order: string[], weights: readonly number[]): number {
  return order.reduce((n, s, i) => n + ((weights[i] ?? 0) > 0 ? (seasons[s]?.games ?? 0) : 0), 0);
}

export function resolvePosition(cfg: BattleSportConfig<unknown>, p: PlayerInput, totals: Totals,
  games: number): { position: string; source: PositionSource } | null {
  const map = (tok: string) => cfg.positionMap[tok.trim().toUpperCase()];
  for (const tok of p.rosterPositions) {
    const pos = map(tok);
    if (pos) return { position: pos, source: 'roster' };
  }
  for (const tok of (p.rawPosition ?? '').split(/[/,\- ]+/).filter(Boolean)) {
    const pos = map(tok);
    if (pos) return { position: pos, source: 'roster' };
  }
  const box = Object.entries(p.boxPositions ?? {})
    .map(([raw, n]) => [map(raw), n] as const)
    .filter(([pos]) => pos)
    .sort((a, b) => b[1] - a[1])[0];
  if (box?.[0]) return { position: box[0], source: 'box' };
  if (games <= 0) return null;
  const inferred = cfg.inferPosition(totals);
  return inferred && cfg.positions[inferred] ? { position: inferred, source: 'inferred' } : null;
}

// ------------------------------------------------------------------ main

interface Work {
  input: PlayerInput;
  position: string;
  source: PositionSource;
  games: number;
  totals: Totals;
}

export function computeRatings(cfg: BattleSportConfig<unknown>, players: PlayerInput[], opts: RatingOptions = {}): PlayerRating[] {
  const order = opts.seasons ?? [...new Set(players.flatMap((p) => Object.keys(p.seasons)))].sort().reverse();
  const weights = opts.seasonWeights ?? BATTLES.ratings.seasonWeights;
  const curve = opts.calibration ?? BATTLES.ratings.calibration;
  const baseline = opts.baselineOvr ?? BATTLES.ratings.baselineOvr;
  const k = cfg.ratings.k;

  const work: Work[] = [];
  for (const input of players) {
    const totals = weightedTotals(input.seasons, order, weights);
    const games = qualifyingGames(input.seasons, order, weights);
    const pos = resolvePosition(cfg, input, totals, games);
    if (!pos) continue;
    work.push({ input, position: pos.position, source: pos.source, games, totals });
  }

  const out: PlayerRating[] = [];
  const byPosition = new Map<string, Work[]>();
  for (const w of work) {
    if (!byPosition.has(w.position)) byPosition.set(w.position, []);
    byPosition.get(w.position)!.push(w);
  }

  for (const [position, group] of byPosition) {
    const def = cfg.positions[position]!;
    const subKeys = Object.keys(def.subRatings);
    const rated = group.filter((w) => w.games > 0);
    for (const w of group.filter((g) => g.games <= 0)) {
      out.push({
        athleteId: w.input.athleteId, position, positionSource: w.source, gamesUsed: 0, isNew: true,
        ovr: baseline, subRatings: Object.fromEntries(subKeys.map((s) => [s, baseline])),
      });
    }
    if (rated.length === 0) continue;

    // metric percentiles (after shrinkage toward the position's pooled baseline)
    const metricKeys = [...new Set(subKeys.flatMap((s) => Object.keys(def.subRatings[s]!.metrics)))];
    const metricPct: Record<string, number[]> = {};
    for (const mk of metricKeys) {
      const m = cfg.metrics[mk];
      if (!m) throw new Error(`${cfg.sport}: sub-rating uses unknown metric '${mk}'`);
      let sn = 0;
      let sd = 0;
      const raw = rated.map((w) => {
        const den = m.den(w.totals);
        const num = m.num(w.totals);
        if (den > 0) { sn += num; sd += den; }
        return den > 0 ? num / den : undefined;
      });
      const base = sd > 0 ? sn / sd : 0;
      const shrunk = raw.map((x, i) => shrink(x ?? base, x === undefined ? 0 : rated[i]!.games, base, k));
      const pct = percentileRanks(shrunk);
      metricPct[mk] = m.lowerIsBetter ? pct.map((p) => 1 - p) : pct;
    }

    // sub-ratings: weighted mean of metric percentiles, re-ranked, calibrated
    const subPct: Record<string, number[]> = {};
    for (const sk of subKeys) {
      const metrics = def.subRatings[sk]!.metrics;
      const composite = rated.map((w, i) => shrinkPercentile(
        weightedMean(Object.fromEntries(Object.keys(metrics).map((mk) => [mk, metricPct[mk]![i]!])), metrics),
        reliability(w.games, k)));
      subPct[sk] = percentileRanks(composite);
    }
    // OVR: position-weighted mean of sub-rating percentiles, re-ranked, calibrated
    const ovrComposite = rated.map((w, i) => shrinkPercentile(
      weightedMean(Object.fromEntries(subKeys.map((sk) => [sk, subPct[sk]![i]!])), def.ovrWeights),
      reliability(w.games, k)));
    const ovrPct = percentileRanks(ovrComposite);

    rated.forEach((w, i) => {
      out.push({
        athleteId: w.input.athleteId,
        position,
        positionSource: w.source,
        gamesUsed: Math.round(w.games),
        isNew: false,
        ovr: toRating(calibrate(ovrPct[i]!, curve)),
        subRatings: Object.fromEntries(subKeys.map((sk) => [sk, toRating(calibrate(subPct[sk]![i]!, curve))])),
      });
    });
  }
  return out;
}
