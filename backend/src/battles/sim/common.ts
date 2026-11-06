/**
 * Timeline + scoreboard + momentum shared by every sport engine.
 *
 * Engines record events with a position inside a segment ("reg" = regulation,
 * "ot" = the overtime segment) as a fraction 0..1 of that segment's game time.
 * finish() maps those fractions to real time: regulation spans
 * timing.regulationMs, overtime timing.overtimeMs, so every match plays back
 * in 120-180 s (+30-60 s with overtime) whatever its game-clock length.
 */
import type { Rng } from '../rng.js';
import type { BattleSport } from '../sports/types.js';
import type { Lineup, MatchEvent, MatchEventType, MatchResult, Side, SimPlayer } from '../types.js';

export const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');
export const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
export const subOf = (p: SimPlayer, key: string) => p.sub[key] ?? p.ovr;
export const avgSub = (ps: SimPlayer[], key: string) => avg(ps.map((p) => subOf(p, key)));
export const byPos = (l: Lineup, ...pos: string[]) => l.players.filter((p) => pos.includes(p.position));

const MIN_GAP_MS = 350;
/** Engines add colour commentary when the feed has been quiet this long. */
export const QUIET_MS = 7_000;

interface Pending extends Omit<MatchEvent, 't'> {
  segment: 'reg' | 'ot';
  at: number;   // 0..1 within segment
}

export class MatchBuilder {
  readonly score: Record<Side, number> = { A: 0, B: 0 };
  momentum = 0;
  private events: Pending[] = [];
  wentToOT = false;
  winnerOverride: Side | null = null;

  constructor(
    readonly sport: BattleSport,
    readonly rng: Rng,
    readonly teams: Record<Side, Lineup>,
    readonly timing: { regulationMs: number; overtimeMs: number },
  ) {}

  name(side: Side) { return this.teams[side].name; }

  /** Real-time ms since the last event, if one were added at `at` in `segment`. */
  quietMs(segment: 'reg' | 'ot', at: number): number {
    const last = this.events[this.events.length - 1];
    if (!last) return Infinity;
    const ms = (seg: 'reg' | 'ot', x: number) => (seg === 'reg' ? x * this.timing.regulationMs : this.timing.regulationMs + x * this.timing.overtimeMs);
    return ms(segment, at) - ms(last.segment, last.at);
  }

  /** "2-1 Gaels" style tag: leader's score first. */
  tag(): string {
    const { A, B } = this.score;
    if (A === B) return `${A}-${B}`;
    return A > B ? `${A}-${B} ${this.name('A')}` : `${B}-${A} ${this.name('B')}`;
  }

  /** Nudge momentum toward `side` by `amount` (0..1), decaying the old value. */
  swing(side: Side | null, amount: number, decay = 0.88) {
    this.momentum *= decay;
    if (side) this.momentum += side === 'A' ? amount : -amount;
    this.momentum = Math.max(-1, Math.min(1, this.momentum));
  }

  add(e: { segment?: 'reg' | 'ot'; at: number; period: string; clock: string; type: MatchEventType; side: Side | null;
    players?: SimPlayer[]; text: string; points?: number; momentum?: number }) {
    if (e.points && e.side) this.score[e.side] += e.points;
    if (e.momentum !== undefined) this.swing(e.side, e.momentum);
    this.events.push({
      segment: e.segment ?? 'reg', at: Math.max(0, Math.min(1, e.at)), period: e.period, clock: e.clock, type: e.type,
      side: e.side, playerIds: (e.players ?? []).map((p) => p.id), text: e.text,
      scoreA: this.score.A, scoreB: this.score.B, momentum: Math.round(this.momentum * 100) / 100 + 0,
    });
  }

  finish(matchId: string, seed: number, finalText: (winner: Side) => string, finalClock = '0:00', finalPeriod?: string): MatchResult {
    const { regulationMs, overtimeMs } = this.timing;
    const winner: Side = this.winnerOverride ?? (this.score.A > this.score.B ? 'A' : 'B');
    const last = this.events[this.events.length - 1];

    // Overtime plays for as long as its content needs, within 30-60 s (capped
    // at timing.overtimeMs): a sudden-death winner 20 seconds in shouldn't be
    // followed by half a minute of nothing.
    const otEvents = this.events.filter((e) => e.segment === 'ot');
    const otContentEnd = otEvents.length ? Math.max(...otEvents.map((e) => e.at)) : 0;
    const otMs = this.wentToOT
      ? Math.max(MIN_OT_MS, Math.min(overtimeMs, Math.round(otContentEnd * overtimeMs + WRAP_MS)))
      : 0;
    const otScale = otContentEnd > 0 ? Math.min(1, (otMs - WRAP_MS) / (otContentEnd * overtimeMs)) : 1;
    const realT = (e: Pending) => (e.segment === 'reg' ? e.at * regulationMs : regulationMs + e.at * overtimeMs * otScale);
    const end = regulationMs + otMs;

    const timed: MatchEvent[] = [];
    let prev = -Infinity;
    for (const p of this.events) {
      const t = Math.round(Math.max(realT(p), prev + MIN_GAP_MS));
      prev = t;
      const { segment: _s, at: _a, ...rest } = p;
      timed.push({ t, ...rest });
    }

    this.swing(winner, 0.2);
    timed.push({
      t: end, period: finalPeriod ?? last?.period ?? 'FINAL', clock: finalClock, type: 'final', side: winner, playerIds: [],
      text: finalText(winner), scoreA: this.score.A, scoreB: this.score.B, momentum: Math.round(this.momentum * 100) / 100 + 0,
    });

    // Fill long silences with score-aware colour, so the feed never stalls.
    const events: MatchEvent[] = [];
    for (let i = 0; i < timed.length; i++) {
      const e = timed[i]!;
      const before = events[events.length - 1];
      if (before && e.t - before.t > FILL_GAP_MS && before.type !== 'final') {
        const n = Math.floor((e.t - before.t) / FILL_GAP_MS);
        for (let k = 1; k <= n; k++) {
          const t = Math.round(before.t + ((e.t - before.t) * k) / (n + 1));
          events.push({ ...before, t, type: 'highlight', side: null, playerIds: [], text: this.colour(before) });
        }
      }
      events.push(e);
    }
    // Min-gap nudges can push a few events past the end: squeeze them back in.
    for (let i = events.length - 2; i >= 0; i--) {
      if (events[i]!.t > events[i + 1]!.t - MIN_GAP_MS / 2) events[i]!.t = events[i + 1]!.t - Math.round(MIN_GAP_MS / 2);
    }
    return {
      matchId, sport: this.sport, seed, events, finalScoreA: this.score.A, finalScoreB: this.score.B, winner,
      wentToOT: this.wentToOT, durationMs: end,
    };
  }

  private colour(at: MatchEvent): string {
    const unit = UNITS[this.sport];
    const { scoreA: a, scoreB: b } = at;
    const vars = { A: this.name('A'), B: this.name('B') };
    if (a === b) return say(this.rng, TIED, { ...vars, score: `${a}-${b}` });
    const lead = a > b ? this.name('A') : this.name('B');
    const trail = a > b ? this.name('B') : this.name('A');
    const d = Math.abs(a - b);
    const margin = `${d === 1 ? 'one' : d === 2 ? 'two' : d === 3 ? 'three' : d}-${unit}`;
    if (Math.abs(at.momentum) > 0.35) {
      const hot = at.momentum > 0 ? this.name('A') : this.name('B');
      return say(this.rng, MOMENTUM, { team: hot });
    }
    return say(this.rng, LEADING, { lead, trail, margin });
  }
}

const MIN_OT_MS = 30_000;
const WRAP_MS = 4_000;
const FILL_GAP_MS = 9_000;
const UNITS: Record<BattleSport, string> = { hockey: 'goal', soccer: 'goal', basketball: 'point', football: 'point', volleyball: 'set' };
const TIED = ['{A} and {B} locked at {score}. Every possession matters.', 'Still level at {score}. Nervy stuff.',
  'Nothing between these two — {score}.', 'Back and forth: {A} {score} {B}.'];
const LEADING = ['{lead} protecting a {margin} lead.', '{trail} need a response here.', '{trail} pressing to get back in it.',
  '{lead} in control, up by a {margin} margin.', '{lead} trying to grind this one out.'];
const MOMENTUM = ['{team} have all the momentum right now.', 'The crowd is behind {team}!', '{team} pouring it on.'];

/** mm:ss from seconds */
export const mmss = (s: number) => {
  const x = Math.max(0, Math.round(s));
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
};

/** Pick a template and fill {a} {b} {team} {score}. */
export function say(rng: Rng, templates: readonly string[], vars: Record<string, string>): string {
  return rng.pick(templates).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}
