/**
 * Canadian football: 4 x 15:00, three downs, 110-yard field, drive by drive.
 * Passes: sack (PRS vs QB), interception (COV vs DEC), completion
 * (ACC + CAT vs COV), yards (ARM/SPD vs COV) with big plays. Runs: RSH/ELU vs
 * TKL, fumbles TAK vs BAL. Third down: go for it on short yardage in range,
 * field goal in range, else punt (singles/rouges possible). Tied after 60:
 * alternating possessions from the opponent's 35 until one side leads after
 * a full round.
 */
import { adjust, type Rng } from '../rng.js';
import type { FootballSim } from '../sports/football.js';
import { SPORTS } from '../sports/index.js';
import type { Lineup, MatchResult, Side, SimPlayer } from '../types.js';
import { avgSub, byPos, MatchBuilder, mmss, other, QUIET_MS, say, subOf } from './common.js';

const TD_PASS = ['{q} finds {r} in the end zone! Touchdown! {score}.', '{q} lofts it to {r} — TOUCHDOWN! {score}.',
  '{r} hauls it in for six! {score}.'];
const TD_RUN = ['{r} punches it in! Touchdown! {score}.', '{r} breaks a tackle and walks in! {score}.'];
const BIG_PASS = ['{q} hits {r} deep for {y} yards!', '{r} gets behind the coverage — {y}-yard gain!', '{q} to {r}, {y} yards.'];
const BIG_RUN = ['{r} bursts through the hole for {y}!', '{r} bounces outside, {y} yards.'];
const SACK = ['{d} gets home — sack on {q}!', '{d} buries {q} for a loss.'];
const INT = ['Picked off! {d} jumps the route on {q}.', '{d} intercepts {q}!'];

type Seg = 'reg' | 'ot';

export function simulateFootball(A: Lineup, B: Lineup, rng: Rng, seed: number, matchId: string): MatchResult {
  const cfg = SPORTS.football;
  const sim: FootballSim = cfg.sim;
  const teams = { A, B };
  const m = new MatchBuilder('football', rng, teams, cfg.timing);
  const s = sim.sensitivity;

  const qb = (l: Lineup) => byPos(l, 'QB')[0] ?? l.players[0]!;
  const rb = (l: Lineup) => byPos(l, 'RB')[0] ?? l.players[0]!;
  const targets = (l: Lineup) => [...byPos(l, 'WR'), rb(l)];
  const defenders = (l: Lineup) => byPos(l, 'DEF');

  let clock = 0;                                 // game seconds elapsed in regulation
  const period = () => cfg.periods[Math.min(3, Math.floor(clock / 900))]!;
  const clockText = () => mmss(900 - (clock % 900));
  const at = () => clock / 3600;

  const score = (side: Side, pts: number, seg: Seg, when: number, per: string, clk: string, players: SimPlayer[], text: (tag: string) => string, mom: number) => {
    m.score[side] += pts;
    const t = text(m.tag());
    m.score[side] -= pts;
    m.add({ segment: seg, at: when, period: per, clock: clk, type: 'goal', side, players, text: t, points: pts, momentum: mom });
  };

  type DriveEnd = 'td' | 'fg' | 'single' | 'punt' | 'turnover' | 'downs' | 'clock';

  /** One drive from `start` (yards from own goal line). Returns how it ended and where the other side takes over. */
  const drive = (side: Side, start: number, seg: Seg, otMode: boolean, when: () => number, per: () => string, clk: () => string,
    tick: () => boolean): { end: DriveEnd; next: number } => {
    const off = teams[side];
    const def = teams[other(side)];
    const d = defenders(def);
    const prs = avgSub(d, 'PRS');
    const cov = avgSub(d, 'COV');
    const tkl = avgSub(d, 'TKL');
    const tak = avgSub(d, 'TAK');
    let pos = start;
    let down = 1;
    let toGo = 10;
    for (let play = 0; play < 40; play++) {
      if (tick()) return { end: 'clock', next: 35 };
      // third-down decision
      if (down === 3) {
        const fgDist = 110 - pos + 10;          // goal posts on the goal line + snap
        const inRange = 110 - pos <= sim.fieldGoalRange;
        const goForIt = (toGo <= 2 && pos >= 50) || (otMode && !inRange);
        if (!goForIt) {
          if (inRange) {
            const pMake = Math.max(0.3, Math.min(0.97, 1.02 - 0.012 * fgDist));
            if (rng.chance(pMake)) {
              score(side, 3, seg, when(), per(), clk(), [], (tag) => `Field goal from ${fgDist} yards is good. ${tag}.`, 0.15);
              return { end: 'fg', next: 35 };
            }
            if (!otMode && rng.chance(0.3)) {
              score(side, 1, seg, when(), per(), clk(), [], (tag) => `The ${fgDist}-yard try is wide but goes through the end zone — single point. ${tag}.`, 0.05);
              return { end: 'single', next: 35 };
            }
            m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'turnover', side, text: `${fgDist}-yard field goal no good.`, momentum: -0.1 });
            return { end: 'turnover', next: Math.max(1, 110 - pos) };
          }
          if (otMode) return { end: 'downs', next: 35 };
          const punt = Math.round(rng.normal(41, 6));
          if (pos + punt >= 110 && rng.chance(0.5)) {
            score(side, 1, seg, when(), per(), clk(), [], (tag) => `Punt sails through the end zone — rouge, single point. ${tag}.`, 0.04);
            return { end: 'single', next: 35 };
          }
          if (rng.chance(0.45)) {
            m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'turnover', side,
              text: `${off.name} stall at their ${pos > 55 ? `opponent's ${110 - pos}` : pos}-yard line and punt.`, momentum: -0.04 });
          }
          return { end: 'punt', next: Math.max(5, Math.min(60, 110 - Math.min(105, pos + punt))) };
        }
      }
      const q = qb(off);
      const pass = rng.chance(down === 3 ? Math.min(0.85, sim.passShare + 0.2) : sim.passShare);
      let gain = 0;
      const actors: SimPlayer[] = [];
      if (pass) {
        if (rng.chance(adjust(sim.sackBase, prs - 0.5 * (subOf(q, 'MOB') + subOf(q, 'DEC')), s))) {
          const rusher = rng.weighted(d, (p) => Math.exp(0.05 * subOf(p, 'PRS')));
          gain = -Math.round(rng.range(4, 10));
          if (rng.chance(0.5)) m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'highlight', side: other(side), players: [rusher, q],
            text: say(rng, SACK, { d: rusher.name, q: q.name }), momentum: 0.1 });
        } else if (rng.chance(adjust(sim.intBase, cov - subOf(q, 'DEC'), s))) {
          const picker = rng.weighted(d, (p) => Math.exp(0.05 * subOf(p, 'COV')));
          m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'turnover', side, players: [picker, q],
            text: say(rng, INT, { d: picker.name, q: q.name }), momentum: -0.3 });
          return { end: 'turnover', next: Math.max(5, Math.min(100, 110 - pos + Math.round(rng.range(-5, 15)))) };
        } else {
          const r = rng.weighted(targets(off), (p) => (p.position === 'RB' ? 0.35 : 1) * Math.exp(0.035 * (subOf(p, 'CAT') || subOf(p, 'REC'))));
          const catchSkill = r.position === 'RB' ? subOf(r, 'REC') : subOf(r, 'CAT');
          if (rng.chance(adjust(sim.completionBase, 0.5 * subOf(q, 'ACC') + 0.5 * catchSkill - cov, s))) {
            const speed = r.position === 'RB' ? subOf(r, 'ELU') : subOf(r, 'SPD');
            gain = Math.max(1, Math.round(rng.normal(sim.passYardsMean + 0.08 * (0.5 * subOf(q, 'ARM') + 0.5 * speed - cov), 5)));
            if (rng.chance(adjust(sim.bigPlayBase, 0.5 * subOf(q, 'ARM') + 0.5 * speed - cov, s))) gain += Math.round(rng.range(15, 50));
            actors.push(q, r);
          } else {
            gain = 0;
            actors.push(q, r);
            if (down === 3 && rng.chance(0.25)) m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'shot', side, players: [q, r],
              text: `Third down: ${q.name} looks for ${r.name}... incomplete.` });
          }
        }
      } else {
        const runner = rng.chance(0.12) ? q : rb(off);
        const skill = runner === q ? subOf(q, 'MOB') : 0.5 * subOf(runner, 'RSH') + 0.5 * subOf(runner, 'ELU');
        if (rng.chance(adjust(sim.fumbleBase, tak - subOf(runner, runner === q ? 'DEC' : 'BAL'), s))) {
          const forcer = rng.weighted(d, (p) => Math.exp(0.05 * subOf(p, 'TAK')));
          m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'turnover', side, players: [forcer, runner],
            text: `Fumble! ${forcer.name} punches it out of ${runner.name}'s arms.`, momentum: -0.3 });
          return { end: 'turnover', next: Math.max(5, 110 - pos) };
        }
        gain = Math.round(rng.normal(sim.rushYardsMean + 0.06 * (skill - tkl), 3.5));
        if (rng.chance(adjust(sim.bigPlayBase * 0.6, skill - tkl, s))) gain += Math.round(rng.range(12, 45));
        actors.push(runner);
      }
      pos += gain;
      if (pos >= 110) {
        const r = actors[actors.length - 1] ?? rb(off);
        const passTd = pass && actors.length === 2;
        score(side, 6, seg, when(), per(), clk(), actors, (tag) => say(rng, passTd ? TD_PASS : TD_RUN, { q: q.name, r: r.name, score: tag }), 0.4);
        const two = otMode && rng.chance(0.5);
        if (two ? rng.chance(0.5) : rng.chance(0.96)) {
          score(side, two ? 2 : 1, seg, when(), per(), clk(), [], (tag) => `${two ? 'Two-point convert is good' : 'Convert is good'}. ${tag}.`, 0.02);
        }
        return { end: 'td', next: 35 };
      }
      if (pos <= 0) {
        score(other(side), 2, seg, when(), per(), clk(), [], (tag) => `Safety! ${off.name} tackled in their own end zone. ${tag}.`, 0.2);
        return { end: 'turnover', next: 35 };
      }
      if (gain >= 15 && actors.length) {
        const r = actors[actors.length - 1]!;
        m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'highlight', side, players: actors,
          text: say(rng, actors.length === 2 ? BIG_PASS : BIG_RUN, { q: q.name, r: r.name, y: String(gain) }), momentum: 0.1 });
      }
      toGo -= gain;
      if (toGo <= 0 && gain > 0 && gain < 15 && actors.length && m.quietMs(seg, when()) > QUIET_MS) {
        const r = actors[actors.length - 1]!;
        m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'highlight', side, players: actors, momentum: 0.03,
          text: actors.length === 2 ? `${q.name} to ${r.name} for ${gain}. First down ${off.name}.` : `${r.name} picks up ${gain} and the first down.` });
      }
      if (toGo <= 0) { down = 1; toGo = Math.min(10, 110 - pos); } else if (++down > 3) {
        m.add({ segment: seg, at: when(), period: per(), clock: clk(), type: 'turnover', side, text: `${off.name} turn it over on downs.`, momentum: -0.15 });
        return { end: 'downs', next: Math.max(5, 110 - pos) };
      }
    }
    return { end: 'downs', next: 35 };
  };

  // ---------------------------------------------------------------- regulation
  const first: Side = rng.chance(0.5) ? 'A' : 'B';
  let side = first;
  let start = 35;
  let lastQuarter = -1;
  let half2 = false;
  m.add({ at: 0, period: 'Q1', clock: '15:00', type: 'period_start', side: null, text: `Kickoff! ${A.name} vs ${B.name}.` });
  const tick = () => {
    clock += rng.range(sim.playSecondsMin, sim.playSecondsMax);
    const q = Math.floor(clock / 900);
    if (q !== lastQuarter && q > 0 && q < 4 && lastQuarter >= 0) {
      m.add({ at: q / 4, period: cfg.periods[q - 1]!, clock: '0:00', type: 'period_end', side: null,
        text: `End of ${cfg.periods[q - 1]}: ${m.name('A')} ${m.score.A}, ${m.name('B')} ${m.score.B}.` });
    }
    lastQuarter = Math.max(lastQuarter, q);
    if (q >= 2 && !half2) return true;          // half-time: the drive ends
    return clock >= 3600;
  };
  lastQuarter = 0;
  while (clock < 3600) {
    const res = drive(side, start, 'reg', false, at, period, clockText, tick);
    if (res.end === 'clock') {
      if (clock >= 3600) break;
      half2 = true;
      side = other(first);
      start = 35;
      clock = Math.max(clock, 1800);
      continue;
    }
    side = other(side);
    start = res.next;
  }
  m.add({ at: 1, period: 'Q4', clock: '0:00', type: 'period_end', side: null, text: `End of regulation: ${m.name('A')} ${m.score.A}, ${m.name('B')} ${m.score.B}.` });
  if (m.score.A !== m.score.B) {
    return m.finish(matchId, seed, (w) => `FINAL: ${m.name(w)} ${Math.max(m.score.A, m.score.B)}, ${m.name(other(w))} ${Math.min(m.score.A, m.score.B)}.`, '0:00', 'Q4');
  }

  // ---------------------------------------------------------------- overtime
  m.wentToOT = true;
  m.add({ segment: 'ot', at: 0, period: 'OT', clock: '', type: 'ot_start', side: null,
    text: 'Overtime! Each side gets the ball at the opponent\'s 35.' });
  let otFirst: Side = rng.chance(0.5) ? 'A' : 'B';
  const rounds = 6;
  for (let round = 0; round < 40; round++) {
    for (const sd of [otFirst, other(otFirst)]) {
      const idx = round * 2 + (sd === otFirst ? 0 : 1);
      const when = () => Math.min(0.98, (idx + 0.5) / (rounds * 2));
      drive(sd, 75, 'ot', true, when, () => 'OT', () => `R${round + 1}`, () => false);
    }
    if (m.score.A !== m.score.B) break;
    otFirst = other(otFirst);
  }
  if (m.score.A === m.score.B) {
    const w: Side = rng.chance(0.5) ? 'A' : 'B';
    score(w, 3, 'ot', 0.99, 'OT', '', [], (tag) => `Walk-off field goal! ${tag}.`, 0.4);
  }
  return m.finish(matchId, seed, (w) => `FINAL (OT): ${m.name(w)} ${Math.max(m.score.A, m.score.B)}, ${m.name(other(w))} ${Math.min(m.score.A, m.score.B)}.`, '', 'OT');
}
