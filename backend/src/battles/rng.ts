/**
 * Deterministic PRNG (sfc32, seeded through splitmix32). Same seed, same
 * sequence, on every platform: the match simulation's reproducibility rests on it.
 */
export interface Rng {
  /** uniform [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** uniform in [a, b) */
  range(a: number, b: number): number;
  chance(p: number): boolean;
  normal(mean?: number, sd?: number): number;
  poisson(lambda: number): number;
  /** index chosen with probability ∝ weights[i] */
  weightedIndex(weights: number[]): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const sm = splitmix32(seed);
  let a = sm(), b = sm(), c = sm(), d = sm();
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  let spare: number | null = null;
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    normal: (mean = 0, sd = 1) => {
      if (spare !== null) {
        const s = spare;
        spare = null;
        return mean + sd * s;
      }
      let u = 0;
      while (u === 0) u = next();
      const r = Math.sqrt(-2 * Math.log(u));
      const th = 2 * Math.PI * next();
      spare = r * Math.sin(th);
      return mean + sd * r * Math.cos(th);
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.normal()));
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k++; p *= next(); } while (p > L);
      return k - 1;
    },
    weightedIndex: (weights) => {
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      if (total <= 0) return Math.floor(next() * weights.length);
      let x = next() * total;
      for (let i = 0; i < weights.length; i++) {
        x -= Math.max(0, weights[i]!);
        if (x < 0) return i;
      }
      return weights.length - 1;
    },
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (items, weight) => items[rng.weightedIndex(items.map(weight))]!,
  };
  return rng;
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => Math.log(p / (1 - p));
/** base probability shifted by `diff` rating points at `slope` per point (logistic). */
export const adjust = (base: number, diff: number, slope: number) => sigmoid(logit(base) + slope * diff);
