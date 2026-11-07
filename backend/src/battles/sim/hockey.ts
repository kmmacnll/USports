/**
 * Hockey: 3 x 20:00, simulated in ticks of `tickSeconds`. Each tick one team
 * carries the puck (team control: PAS/SKT/DEF), may shoot (shotRate), and a
 * shot beats the goalie with P = adjust(goalBase, SHT - (REF·0.7 + D DEF·0.3)).
 * Penalties give 2:00 power plays. Tied after 60: 5:00 of 3v3 sudden death
 * (best two forwards + best defender), then a shootout (winner +1 goal).
 */
import { adjust, type Rng, sigmoid } from '../rng.js';
import type { HockeySim } from '../sports/hockey.js';
import { SPORTS } from '../sports/index.js';
import type { Lineup, MatchResult, Side, SimPlayer } from '../types.js';
import { avg, avgSub, byPos, MatchBuilder, mmss, other, QUIET_MS, say, subOf } from './common.js';

const GOAL = [
  '{a} rips one top shelf! {score}.', '{a} buries it from the slot! {score}.', '{a} snaps it past the glove! {score}.',
  '{a} with a one-timer — it\'s in! {score}.', '{a} tips it home! {score}.', '{a} goes five-hole! {score}.',
  'Bar down! {a} scores! {score}.', '{a} finishes off the rush! {score}.',
];
const SAVE = ['{g} turns aside {a}.', 'Big glove save by {g} on {a}!', '{g} kicks out the pad on {a}\'s wrister.',
  '{g} stays square and stops {a}.', 'Robbery! {g} denies {a} point-blank.', '{a} walks in alone — {g} says no!'];
const SAVE_POINT = ['{a} fires from the point — {g} smothers it.', '{a} winds up from the blue line, {g} gloves it.',
  '{g} sees {a}\'s point shot all the way.'];
const MISS = ['{a} rings it off the post!', '{a} fires wide.', '{a}\'s shot is blocked in front.', '{a} can\'t get a handle on the rebound.'];
const LINE = ['{team} change on the fly.', '{team} cycling it down low: {a} to {b}.', '{a} carries it in for {team}.', '{team} dump it in and chase.'];
const PEN = ['{a} goes to the box for tripping.', '{a} called for hooking — power play {team}.', '{a} sits two for slashing.',
  '{a} takes a roughing minor.', 'Interference on {a}. {team} go on the power play.'];

export function simulateHockey(A: Lineup, B: Lineup, rng: Rng, seed: number, matchId: string): MatchResult {
  const cfg = SPORTS.hockey;
  const sim: HockeySim = cfg.sim;
  const teams = { A, B };
  const m = new MatchBuilder('hockey', rng, teams, cfg.timing);
  const s = sim.sensitivity;

  const control = (l: Lineup) => avg(l.players.filter((p) => p.position !== 'G')
    .map((p) => (p.position === 'D' ? (subOf(p, 'PAS') + subOf(p, 'SKT') + subOf(p, 'DEF')) / 3 : (subOf(p, 'PAS') + subOf(p, 'SKT')) / 2)));
  const goalie = (l: Lineup) => byPos(l, 'G')[0] ?? l.players[0]!;
  const defWall = (l: Lineup) => avgSub(byPos(l, 'D'), 'DEF') || avgSub(l.players, 'DEF');

  /** One shot attempt by `side`; returns true on a goal. */
  const shoot = (side: Side, skaters: SimPlayer[], seg: 'reg' | 'ot', at: number, period: string, clock: string,
    goalBoost: number, situation: string): boolean => {
    const opp = teams[other(side)];
    const g = goalie(opp);
    const shooter = rng.weighted(skaters, (p) => (p.position === 'D' ? 0.4 : 1) * Math.exp(0.04 * subOf(p, 'SHT')));
    const resist = 0.7 * subOf(g, 'REF') + 0.3 * defWall(opp);
    const p = adjust(sim.goalBase * goalBoost, subOf(shooter, 'SHT') - resist, s);
    if (rng.chance(p)) {
      const helpers = skaters.filter((x) => x !== shooter);
      const assist = helpers.length && rng.chance(0.85) ? rng.weighted(helpers, (x) => Math.exp(0.05 * subOf(x, 'PAS'))) : undefined;
      m.score[side] += 1;
      const text = say(rng, GOAL, { a: shooter.name, score: m.tag() }) + (assist ? ` Helper: ${assist.name}.` : '') + situation;
      m.score[side] -= 1;
      m.add({ segment: seg, at, period, clock, type: 'goal', side, players: assist ? [shooter, assist] : [shooter], text, points: 1, momentum: 0.35 });
      return true;
    }
    if (rng.chance(0.5)) {
      m.add({ segment: seg, at, period, clock, type: 'save', side: other(side), players: [g, shooter],
        text: say(rng, shooter.position === 'D' && rng.chance(0.6) ? SAVE_POINT : SAVE, { g: g.name, a: shooter.name }), momentum: 0.06 });
    }
    return false;
  };

  // ---------------------------------------------------------------- regulation
  const ticksPerPeriod = Math.round(1200 / sim.tickSeconds);
  const total = ticksPerPeriod * 3;
  const pp: Record<Side, number> = { A: 0, B: 0 };      // ticks of power play remaining for that side
  const ctrl = { A: control(A), B: control(B) };
  const phy = { A: avgSub(A.players.filter((p) => p.position !== 'G'), 'PHY'), B: avgSub(B.players.filter((p) => p.position !== 'G'), 'PHY') };
  const period = (i: number) => cfg.periods[Math.floor(i / ticksPerPeriod)]!;
  const clockAt = (i: number) => mmss(1200 - ((i % ticksPerPeriod) + rng.next()) * sim.tickSeconds);

  for (let i = 0; i < total; i++) {
    const at = (i + 0.5) / total;
    if (i % ticksPerPeriod === 0) {
      m.add({ at: i / total, period: period(i), clock: '20:00', type: 'period_start', side: null,
        text: i === 0 ? `Puck drop! ${A.name} vs ${B.name}.` : `${period(i)} underway. ${m.tag()}.` });
    }
    const clock = clockAt(i);
    for (const side of ['A', 'B'] as Side[]) {
      if (pp.A === 0 && pp.B === 0 && rng.chance(sim.penaltyRate * Math.exp(-0.03 * (phy[side] - phy[other(side)])))) {
        const culprit = rng.pick(teams[side].players.filter((p) => p.position !== 'G'));
        pp[other(side)] = Math.round(120 / sim.tickSeconds);
        m.add({ at, period: period(i), clock, type: 'penalty', side, players: [culprit],
          text: say(rng, PEN, { a: culprit.name, team: m.name(other(side)) }), momentum: -0.08 });
      }
    }
    const ppSide: Side | null = pp.A > 0 ? 'A' : pp.B > 0 ? 'B' : null;
    const pA = sigmoid(sim.possessionSensitivity * (ctrl.A - ctrl.B) + (ppSide === 'A' ? 0.6 : ppSide === 'B' ? -0.6 : 0));
    const side: Side = rng.chance(pA) ? 'A' : 'B';
    const shotRate = sim.shotRate * (ppSide === side ? sim.powerPlayShotBoost : ppSide ? 0.55 : 1);
    if (rng.chance(shotRate)) {
      const skaters = teams[side].players.filter((p) => p.position !== 'G');
      const scored = shoot(side, skaters, 'reg', at, period(i), clock, ppSide === side ? sim.powerPlayGoalBoost : 1,
        ppSide === side ? ' Power-play goal.' : ppSide ? ' Shorthanded!' : '');
      if (scored && ppSide === side) pp[side] = 0;
    }
    if (m.quietMs('reg', at) > QUIET_MS) {
      const skaters = teams[side].players.filter((p) => p.position !== 'G');
      const [a, b] = [rng.pick(skaters), rng.pick(skaters)];
      const missed = rng.chance(0.5);
      m.add({ at, period: period(i), clock, type: missed ? 'shot' : 'highlight', side, players: missed ? [a] : [a, b],
        text: say(rng, missed ? MISS : LINE, { a: a.name, b: b.name, team: m.name(side) }), momentum: 0.03 });
    }
    if (pp.A > 0) pp.A--;
    if (pp.B > 0) pp.B--;
    if ((i + 1) % ticksPerPeriod === 0) {
      m.add({ at: (i + 1) / total, period: period(i), clock: '0:00', type: 'period_end', side: null,
        text: `End of ${period(i)}: ${m.name('A')} ${m.score.A}, ${m.name('B')} ${m.score.B}.` });
    }
  }
  if (m.score.A !== m.score.B) {
    return m.finish(matchId, seed, (w) => `FINAL: ${m.name(w)} win ${Math.max(m.score.A, m.score.B)}-${Math.min(m.score.A, m.score.B)}.`, '0:00', 'P3');
  }

  // ---------------------------------------------------------------- 3v3 sudden death
  m.wentToOT = true;
  const threeOnThree = (l: Lineup) => [
    ...byPos(l, 'F').sort((a, b) => b.ovr - a.ovr).slice(0, 2),
    ...byPos(l, 'D').sort((a, b) => b.ovr - a.ovr).slice(0, 1),
  ];
  const ot = { A: threeOnThree(A), B: threeOnThree(B) };
  m.add({ segment: 'ot', at: 0, period: 'OT', clock: '5:00', type: 'ot_start', side: null,
    text: `Overtime! 3-on-3, next goal wins. ${ot.A.map((p) => p.name).join(', ')} vs ${ot.B.map((p) => p.name).join(', ')}.` });
  const otTicks = Math.round(sim.otSeconds / sim.tickSeconds);
  const otShare = 0.6;   // the shootout gets the rest of the OT segment
  const otCtrl = { A: avg(ot.A.map((p) => (subOf(p, 'SKT') + subOf(p, 'PAS')) / 2)), B: avg(ot.B.map((p) => (subOf(p, 'SKT') + subOf(p, 'PAS')) / 2)) };
  for (let i = 0; i < otTicks; i++) {
    const at = ((i + 0.5) / otTicks) * otShare;
    const side: Side = rng.chance(sigmoid(sim.possessionSensitivity * (otCtrl.A - otCtrl.B))) ? 'A' : 'B';
    if (rng.chance(sim.shotRate * sim.otShotBoost)) {
      if (shoot(side, ot[side], 'ot', at, 'OT', mmss(sim.otSeconds - (i + rng.next()) * sim.tickSeconds), 1.15, ' OVERTIME WINNER!')) {
        return m.finish(matchId, seed, (w) => `FINAL (OT): ${m.name(w)} win it ${Math.max(m.score.A, m.score.B)}-${Math.min(m.score.A, m.score.B)}!`, '', 'OT');
      }
    }
  }

  // ---------------------------------------------------------------- shootout
  m.add({ segment: 'ot', at: otShare, period: 'SO', clock: '', type: 'highlight', side: null, text: 'Still tied after overtime. To the shootout!' });
  const order = (l: Lineup) => l.players.filter((p) => p.position !== 'G').sort((a, b) => subOf(b, 'SHT') - subOf(a, 'SHT'));
  const shooters = { A: order(A), B: order(B) };
  const made: Record<Side, number> = { A: 0, B: 0 };
  const taken: Record<Side, number> = { A: 0, B: 0 };
  const decided = (round: number) => (round < 3
    ? made.A > made.B + (3 - taken.B) || made.B > made.A + (3 - taken.A)     // best of three, stop when out of reach
    : taken.A === taken.B && made.A !== made.B);                             // then sudden death
  let shot = 0;
  shootout: for (let round = 0; round < 20; round++) {
    for (const side of ['A', 'B'] as Side[]) {
      const shooter = shooters[side][round % shooters[side].length]!;
      const g = goalie(teams[other(side)]);
      const scored = rng.chance(adjust(sim.shootoutBase, subOf(shooter, 'SHT') - subOf(g, 'REF'), s));
      made[side] += scored ? 1 : 0;
      taken[side] += 1;
      const tally = `(${made.A}-${made.B} in the shootout)`;
      m.add({ segment: 'ot', at: otShare + (1 - otShare) * Math.min(0.95, ++shot / 12), period: 'SO', clock: '',
        type: scored ? 'highlight' : 'save', side: scored ? side : other(side), players: scored ? [shooter] : [g, shooter],
        text: scored ? `${shooter.name} dekes and scores! ${tally}` : `${g.name} stones ${shooter.name}! ${tally}`, momentum: 0.15 });
      if (decided(round)) break shootout;
    }
  }
  const w: Side = made.A > made.B ? 'A' : made.B > made.A ? 'B' : (rng.chance(0.5) ? 'A' : 'B');
  m.score[w] += 1;          // the shootout winner is credited one goal
  m.winnerOverride = w;
  return m.finish(matchId, seed, (win) => `FINAL (SO): ${m.name(win)} win the shootout ${Math.max(made.A, made.B)}-${Math.min(made.A, made.B)}. ` +
    `${m.name('A')} ${m.score.A}, ${m.name('B')} ${m.score.B}.`, '', 'SO');
}
