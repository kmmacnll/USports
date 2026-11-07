/**
 * Soccer (7-a-side abstraction): 2 x 45 minutes in one-minute ticks. The
 * midfield battle (MID PAS/DEF + DEF DEF) decides possession; the side on
 * the ball creates a chance (attack vs defence), the shooter (ATT) puts it on
 * target (FIN vs defence) and beats the keeper (FIN vs REF/POS). Fouls and
 * cards come from DIS. Level after 90: golden-goal extra time, then penalties
 * (the score stays level; the winner is decided on penalties).
 */
import { adjust, type Rng, sigmoid } from '../rng.js';
import { SPORTS } from '../sports/index.js';
import type { SoccerSim } from '../sports/soccer.js';
import type { Lineup, MatchResult, Side, SimPlayer } from '../types.js';
import { avg, avgSub, byPos, MatchBuilder, other, QUIET_MS, say, subOf } from './common.js';

const GOAL = ['GOAL! {a} slots it into the bottom corner! {score}.', '{a} heads it home! {score}.',
  'What a strike from {a}! {score}.', '{a} rounds the keeper and scores! {score}.', '{a} volleys it in! {score}.',
  'GOAL! {a} curls one into the top corner! {score}.'];
const SAVE = ['{g} gets down well to deny {a}.', 'Fingertip save by {g} on {a}\'s drive!', '{g} smothers {a}\'s effort.',
  '{a} forces a sharp stop from {g}.'];
const MISS = ['{a} fires over the bar.', '{a} drags it wide.', '{a}\'s shot is blocked.', '{a} hits the post!'];
const WIN_BALL = ['{d} reads it and steps in to win the ball.', '{d} with a perfectly timed tackle.', '{d} cuts out the through ball.',
  '{d} snuffs out the danger.'];
const BUILD = ['{a} drives forward down the wing.', '{a} switches play.', '{a} threads a pass into the box — cleared.',
  '{a} wins a corner.'];
const KEEP = ['{team} knock it around at the back.', '{a} probes for an opening.', '{a} keeps it under pressure.',
  '{team} patient in possession, {a} on the ball.', '{a} looks up and spreads it wide.'];
const FOUL = ['{a} goes in late — free kick.', '{a} brings down the runner.', '{a} pulls back the shirt.'];

const minuteClock = (minute: number, half: number) => {
  const base = half === 1 ? 45 : 90;
  return minute > base ? `${base}+${minute - base}'` : `${minute}'`;
};

export function simulateSoccer(A: Lineup, B: Lineup, rng: Rng, seed: number, matchId: string): MatchResult {
  const cfg = SPORTS.soccer;
  const sim: SoccerSim = cfg.sim;
  const teams = { A, B };
  const m = new MatchBuilder('soccer', rng, teams, cfg.timing);
  const s = sim.sensitivity;

  const keeper = (l: Lineup) => byPos(l, 'GK')[0] ?? l.players[0]!;
  const midfield = (l: Lineup) => avg([...byPos(l, 'MID').map((p) => 0.6 * subOf(p, 'PAS') + 0.4 * subOf(p, 'DEF')),
    ...byPos(l, 'DEF').map((p) => 0.5 * subOf(p, 'DEF') + 0.5 * subOf(p, 'PAS'))]);
  const attack = (l: Lineup) => avg([...byPos(l, 'FWD').map((p) => subOf(p, 'ATT')), ...byPos(l, 'MID').map((p) => subOf(p, 'PAS'))]);
  const defence = (l: Lineup) => avg([...byPos(l, 'DEF').map((p) => subOf(p, 'DEF')), ...byPos(l, 'MID').map((p) => subOf(p, 'DEF')),
    subOf(keeper(l), 'POS')]);
  const ctrl = { A: midfield(A), B: midfield(B) };
  const atk = { A: attack(A), B: attack(B) };
  const dfn = { A: defence(A), B: defence(B) };

  const chance = (side: Side, seg: 'reg' | 'ot', at: number, period: string, clock: string, rateBoost = 1): boolean => {
    const opp = other(side);
    const off = teams[side];
    if (!rng.chance(adjust(sim.chanceRate * rateBoost, atk[side] - dfn[opp], s))) {
      // narrate some of the play that comes to nothing
      if (rng.chance(0.12)) {
        const d = rng.weighted(teams[opp].players.filter((p) => p.position === 'DEF' || p.position === 'MID'), (p) => Math.exp(0.05 * subOf(p, 'DEF')));
        m.add({ segment: seg, at, period, clock, type: 'turnover', side, players: [d], text: say(rng, WIN_BALL, { d: d.name }), momentum: -0.03 });
      } else if (rng.chance(0.11)) {
        const a = rng.weighted(off.players.filter((p) => p.position !== 'GK'), (p) => Math.exp(0.05 * subOf(p, 'PAS')));
        m.add({ segment: seg, at, period, clock, type: 'highlight', side, players: [a], text: say(rng, BUILD, { a: a.name }), momentum: 0.03 });
      }
      return false;
    }
    const shooter = rng.weighted(off.players.filter((p) => p.position !== 'GK'),
      (p) => (p.position === 'FWD' ? 3 : p.position === 'MID' ? 1.3 : 0.3) * Math.exp(0.04 * subOf(p, 'ATT')));
    const gk = keeper(teams[opp]);
    if (!rng.chance(adjust(sim.onTargetBase, subOf(shooter, 'FIN') - dfn[opp], s))) {
      if (rng.chance(0.85)) m.add({ segment: seg, at, period, clock, type: 'shot', side, players: [shooter], text: say(rng, MISS, { a: shooter.name }), momentum: 0.04 });
      return false;
    }
    const pGoal = adjust(sim.goalBase / sim.onTargetBase, subOf(shooter, 'FIN') - (0.7 * subOf(gk, 'REF') + 0.3 * subOf(gk, 'POS')), s);
    if (rng.chance(Math.min(0.95, pGoal))) {
      const helpers = off.players.filter((p) => p !== shooter && p.position !== 'GK');
      const assist = rng.chance(0.75) ? rng.weighted(helpers, (p) => (p.position === 'MID' ? 2 : 1) * Math.exp(0.05 * subOf(p, 'PAS'))) : undefined;
      m.score[side] += 1;
      const text = say(rng, GOAL, { a: shooter.name, score: m.tag() }) + (assist ? ` Assist ${assist.name}.` : '');
      m.score[side] -= 1;
      m.add({ segment: seg, at, period, clock, type: 'goal', side, players: assist ? [shooter, assist] : [shooter], text, points: 1, momentum: 0.4 });
      return true;
    }
    m.add({ segment: seg, at, period, clock, type: 'save', side: opp, players: [gk, shooter], text: say(rng, SAVE, { g: gk.name, a: shooter.name }), momentum: 0.08 });
    return false;
  };

  const foul = (side: Side, seg: 'reg' | 'ot', at: number, period: string, clock: string) => {
    const outfield = teams[side].players.filter((p) => p.position !== 'GK');
    if (!rng.chance(sim.foulRate)) return;
    const culprit = rng.weighted(outfield, (p) => Math.exp(-0.04 * subOf(p, 'DIS')));
    const card = rng.chance(sim.yellowShare);
    if (card || rng.chance(0.6)) {
      m.add({ segment: seg, at, period, clock, type: card ? 'penalty' : 'foul', side, players: [culprit],
        text: say(rng, FOUL, { a: culprit.name }) + (card ? ' Yellow card.' : ''),
        momentum: -0.05 });
    }
  };

  // ---------------------------------------------------------------- 90 minutes
  const stoppage = [1 + rng.int(3), 2 + rng.int(4)];
  const minutes = [45 + stoppage[0]!, 45 + stoppage[1]!];
  const totalMin = minutes[0]! + minutes[1]!;
  let elapsed = 0;
  for (const half of [1, 2]) {
    const period = half === 1 ? '1H' : '2H';
    m.add({ at: elapsed / totalMin, period, clock: half === 1 ? "0'" : "45'", type: 'period_start', side: null,
      text: half === 1 ? `Kick-off! ${A.name} vs ${B.name}.` : `Second half underway. ${m.tag()}.` });
    for (let i = 1; i <= minutes[half - 1]!; i++) {
      const minute = (half === 1 ? 0 : 45) + i;
      const at = (elapsed + i - 0.5) / totalMin;
      const clock = minuteClock(minute, half);
      const side: Side = rng.chance(sigmoid(sim.possessionSensitivity * (ctrl.A - ctrl.B))) ? 'A' : 'B';
      chance(side, 'reg', at, period, clock);
      foul(other(side), 'reg', at, period, clock);
      if (m.quietMs('reg', at) > QUIET_MS) {
        const a = rng.weighted(teams[side].players.filter((p) => p.position !== 'GK'), (p) => Math.exp(0.05 * subOf(p, 'PAS')));
        m.add({ at, period, clock, type: 'highlight', side, players: [a], momentum: 0.02,
          text: say(rng, KEEP, { a: a.name, team: m.name(side) }) });
      }
    }
    elapsed += minutes[half - 1]!;
    m.add({ at: elapsed / totalMin, period, clock: half === 1 ? `45+${stoppage[0]}'` : `90+${stoppage[1]}'`, type: 'period_end', side: null,
      text: half === 1 ? `Half-time: ${m.name('A')} ${m.score.A}, ${m.name('B')} ${m.score.B}.` : `Full time in regulation: ${m.tag()}.` });
  }
  if (m.score.A !== m.score.B) {
    return m.finish(matchId, seed, (w) => `FULL TIME: ${m.name(w)} win ${Math.max(m.score.A, m.score.B)}-${Math.min(m.score.A, m.score.B)}.`, `90+${stoppage[1]}'`, '2H');
  }

  // ---------------------------------------------------------------- golden goal
  m.wentToOT = true;
  m.add({ segment: 'ot', at: 0, period: 'OT', clock: "90'", type: 'ot_start', side: null, text: 'Extra time — golden goal! Next goal wins it.' });
  const ggShare = 0.55;
  for (let i = 1; i <= sim.goldenGoalMinutes; i++) {
    const at = ((i - 0.5) / sim.goldenGoalMinutes) * ggShare;
    const side: Side = rng.chance(sigmoid(sim.possessionSensitivity * (ctrl.A - ctrl.B))) ? 'A' : 'B';
    if (chance(side, 'ot', at, 'OT', `${90 + i}'`, 1.15)) {
      return m.finish(matchId, seed, (w) => `GOLDEN GOAL! ${m.name(w)} win ${Math.max(m.score.A, m.score.B)}-${Math.min(m.score.A, m.score.B)} in extra time.`,
        `${90 + i}'`, 'OT');
    }
  }

  // ---------------------------------------------------------------- penalties
  m.add({ segment: 'ot', at: ggShare, period: 'PK', clock: '', type: 'highlight', side: null, text: 'No golden goal. It goes to penalties!' });
  const takers = (l: Lineup) => l.players.filter((p) => p.position !== 'GK').sort((a, b) => subOf(b, 'FIN') - subOf(a, 'FIN'));
  const order: Record<Side, SimPlayer[]> = { A: takers(A), B: takers(B) };
  const made: Record<Side, number> = { A: 0, B: 0 };
  const taken: Record<Side, number> = { A: 0, B: 0 };
  const decided = (round: number) => (round < 5
    ? made.A > made.B + (5 - taken.B) || made.B > made.A + (5 - taken.A)
    : taken.A === taken.B && made.A !== made.B);
  let kick = 0;
  pens: for (let round = 0; round < 30; round++) {
    for (const side of ['A', 'B'] as Side[]) {
      const taker = order[side][round % order[side].length]!;
      const gk = keeper(teams[other(side)]);
      const scored = rng.chance(adjust(sim.penaltyBase, subOf(taker, 'FIN') - subOf(gk, 'REF'), s));
      made[side] += scored ? 1 : 0;
      taken[side] += 1;
      m.add({ segment: 'ot', at: ggShare + (1 - ggShare) * Math.min(0.95, ++kick / 14), period: 'PK', clock: '',
        type: scored ? 'highlight' : 'save', side: scored ? side : other(side), players: scored ? [taker] : [gk, taker],
        text: scored ? `${taker.name} sends the keeper the wrong way. (${made.A}-${made.B} on penalties)`
          : `${gk.name} saves from ${taker.name}! (${made.A}-${made.B} on penalties)`, momentum: 0.15 });
      if (decided(round)) break pens;
    }
  }
  m.winnerOverride = made.A > made.B ? 'A' : made.B > made.A ? 'B' : (rng.chance(0.5) ? 'A' : 'B');
  return m.finish(matchId, seed, (w) => `${m.name(w)} win ${Math.max(made.A, made.B)}-${Math.min(made.A, made.B)} on penalties! ` +
    `(${m.score.A}-${m.score.B} after extra time)`, '', 'PK');
}
