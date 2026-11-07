/**
 * Basketball: 4 x 10:00 (FIBA), possession by possession. Each possession:
 * turnover (PLY vs DEF), shooting foul (two free throws), or a shot — a three
 * (3PT) or a two (SCO) against the matched defender's DEF — with offensive
 * rebounds (REB vs REB) extending it. Tied after 40: 5:00 overtime periods
 * until someone wins.
 */
import { adjust, type Rng } from '../rng.js';
import type { BasketballSim } from '../sports/basketball.js';
import { SPORTS } from '../sports/index.js';
import type { Lineup, MatchResult, Side, SimPlayer } from '../types.js';
import { avgSub, MatchBuilder, mmss, other, say, subOf } from './common.js';

const TWO = ['{a} drives and lays it in. {score}.', '{a} pulls up from the elbow — good. {score}.', '{a} with the floater. {score}.',
  '{a} spins baseline and scores! {score}.', '{a} finishes through contact. {score}.', 'Alley-oop to {a}! {score}.'];
const THREE = ['{a} from downtown — BANG! {score}.', '{a} drains the three! {score}.', '{a} catches and fires... splash! {score}.',
  'Step-back three by {a}! {score}.', '{a} from the corner — got it! {score}.'];
const STEAL = ['{d} picks {a}\'s pocket!', '{d} jumps the passing lane — steal!', '{a} coughs it up, {d} with the steal.'];
const TO = ['{a} travels.', '{a} throws it away.', 'Shot-clock violation on {team}.', '{a} steps out of bounds.'];
const BLOCK = ['{d} sends {a}\'s shot into the stands!', 'Rejected! {d} swats {a}.'];

export function simulateBasketball(A: Lineup, B: Lineup, rng: Rng, seed: number, matchId: string): MatchResult {
  const cfg = SPORTS.basketball;
  const sim: BasketballSim = cfg.sim;
  const teams = { A, B };
  const m = new MatchBuilder('basketball', rng, teams, cfg.timing);
  const s = sim.sensitivity;
  const runs: Record<Side, number> = { A: 0, B: 0 };

  /** The defender guarding `p`: same slot if there is one, else anyone. */
  const matchup = (p: SimPlayer, def: Lineup) => {
    const same = def.players.filter((d) => d.position === p.position);
    return same.length ? rng.pick(same) : rng.pick(def.players);
  };

  const scored = (side: Side, pts: number, seg: 'reg' | 'ot', at: number, period: string, clock: string, players: SimPlayer[], text: string) => {
    runs[side] += pts;
    runs[other(side)] = 0;
    m.add({ segment: seg, at, period, clock, type: 'point', side, players, text, points: pts, momentum: 0.04 * pts });
    if (runs[side] >= 8 && runs[side] - pts < 8) {
      m.add({ segment: seg, at, period, clock, type: 'highlight', side, text: `${m.name(side)} on ${[8, 11, 18].includes(runs[side]) ? 'an' : 'a'} ${runs[side]}-0 run!`, momentum: 0.2 });
    }
  };

  const possession = (side: Side, seg: 'reg' | 'ot', at: number, period: string, clock: string) => {
    const off = teams[side];
    const def = teams[other(side)];
    const handler = rng.weighted(off.players, (p) => (p.position === 'G' ? 2 : 1) * Math.exp(0.04 * subOf(p, 'PLY')));
    if (rng.chance(adjust(sim.turnoverBase, avgSub(def.players, 'DEF') - avgSub(off.players, 'PLY'), s))) {
      if (rng.chance(0.3)) {
        const d = rng.weighted(def.players, (p) => Math.exp(0.05 * subOf(p, 'DEF')));
        const steal = rng.chance(0.55);
        m.add({ segment: seg, at, period, clock, type: 'turnover', side, players: steal ? [handler, d] : [handler],
          text: steal ? say(rng, STEAL, { a: handler.name, d: d.name }) : say(rng, TO, { a: handler.name, team: off.name }), momentum: -0.05 });
      }
      return;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const shooter = rng.weighted(off.players, (p) => Math.exp(0.045 * subOf(p, 'SCO')));
      const defender = matchup(shooter, def);
      if (attempt === 0 && rng.chance(sim.foulRate)) {
        const pFt = adjust(sim.freeThrowBase, subOf(shooter, 'SCO') - subOf(defender, 'DEF'), s * 0.5);
        const made = (rng.chance(pFt) ? 1 : 0) + (rng.chance(pFt) ? 1 : 0);
        if (made) {
          m.score[side] += made;
          const text = `${shooter.name} hits ${made === 2 ? 'both' : '1 of 2'} at the line. ${m.tag()}.`;
          m.score[side] -= made;
          scored(side, made, seg, at, period, clock, [shooter], text);
        }
        return;
      }
      const threeShare = sim.threeShare * Math.exp(0.02 * (subOf(shooter, '3PT') - subOf(shooter, 'SCO')));
      const three = rng.chance(Math.min(0.7, threeShare));
      const p = three
        ? adjust(sim.threeBase, subOf(shooter, '3PT') - subOf(defender, 'DEF'), s)
        : adjust(sim.twoBase, subOf(shooter, 'SCO') - subOf(defender, 'DEF'), s);
      if (rng.chance(p)) {
        const pts = three ? 3 : 2;
        m.score[side] += pts;
        const text = say(rng, three ? THREE : TWO, { a: shooter.name, score: m.tag() });
        m.score[side] -= pts;
        scored(side, pts, seg, at, period, clock, [shooter], text);
        return;
      }
      if (!three && rng.chance(0.06)) {
        m.add({ segment: seg, at, period, clock, type: 'highlight', side: other(side), players: [defender, shooter],
          text: say(rng, BLOCK, { a: shooter.name, d: defender.name }), momentum: 0.08 });
      }
      if (!rng.chance(adjust(sim.offRebBase, avgSub(off.players, 'REB') - avgSub(def.players, 'REB'), s))) return;
    }
  };

  const playPeriod = (seg: 'reg' | 'ot', period: string, seconds: number, startAt: number, span: number, first: Side) => {
    m.add({ segment: seg, at: startAt, period, clock: mmss(seconds), type: seg === 'ot' && period !== 'Q1' ? 'ot_start' : 'period_start',
      side: null, text: period === 'Q1' ? `Tip-off! ${A.name} vs ${B.name}.` : seg === 'ot' ? `Overtime! ${m.tag()}. Five more minutes.` : `${period} underway. ${m.tag()}.` });
    let clock = seconds;
    let side = first;
    while (clock > 0) {
      const used = Math.min(clock, rng.range(sim.possessionMin, sim.possessionMax));
      clock -= used;
      possession(side, seg, startAt + span * (1 - clock / seconds), period, mmss(clock));
      side = other(side);
    }
    m.add({ segment: seg, at: startAt + span, period, clock: '0:00', type: 'period_end', side: null,
      text: `End of ${period}: ${m.name('A')} ${m.score.A}, ${m.name('B')} ${m.score.B}.` });
  };

  const tip: Side = rng.chance(0.5) ? 'A' : 'B';
  cfg.periods.forEach((q, i) => playPeriod('reg', q, 600, i / 4, 1 / 4, i % 2 === 0 ? tip : other(tip)));
  if (m.score.A === m.score.B) {
    m.wentToOT = true;
    // Several overtimes share the overtime segment.
    for (let n = 0; m.score.A === m.score.B && n < 6; n++) {
      const span = n === 0 ? 0.6 : 0.4 / 2 ** n;
      const start = n === 0 ? 0 : 1 - 0.4 / 2 ** (n - 1);
      playPeriod('ot', n === 0 ? 'OT' : `${n + 1}OT`, sim.otSeconds, start, span, rng.chance(0.5) ? 'A' : 'B');
    }
    if (m.score.A === m.score.B) {                     // practically unreachable; keep the result decisive
      const w: Side = rng.chance(0.5) ? 'A' : 'B';
      m.add({ segment: 'ot', at: 0.99, period: 'OT', clock: '0:01', type: 'point', side: w, players: [rng.pick(teams[w].players)],
        text: `Buzzer-beater free throw for ${m.name(w)}!`, points: 1, momentum: 0.3 });
    }
  }
  return m.finish(matchId, seed, (w) => `FINAL${m.wentToOT ? ' (OT)' : ''}: ${m.name(w)} ${Math.max(m.score.A, m.score.B)}, ` +
    `${m.name(other(w))} ${Math.min(m.score.A, m.score.B)}.`, '0:00');
}
