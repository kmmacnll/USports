/**
 * Volleyball: best of five, rally by rally. Serve: ace (SRV vs the receivers'
 * DIG) or service error, else the receiving side attacks: the attacker's ATK
 * plus the setter's SET against the block (BLK) and back-row defence (DIG)
 * gives kill / stuff block / attack error / dug (the rally continues the
 * other way). Sets to 25 (fifth to 15), win by two. There is no overtime:
 * a fifth set is the overtime segment for playback timing.
 * Scores in events are SETS won; the clock shows the points in the current set.
 */
import { adjust, type Rng } from '../rng.js';
import { SPORTS } from '../sports/index.js';
import type { VolleyballSim } from '../sports/volleyball.js';
import type { Lineup, MatchResult, Side, SimPlayer } from '../types.js';
import { avgSub, byPos, MatchBuilder, other, say, subOf } from './common.js';

const KILL = ['{a} hammers it down the line!', '{a} with a rocket cross-court kill!', '{a} tools the block.',
  'Quick set to {a} — kill!', '{a} rips it off the blocker\'s hands.', '{a} finds the seam. Kill.'];
const ACE = ['ACE! {a} paints the end line.', '{a} with a jump-serve ace!', 'Ace from {a} — nobody touched it.'];
const BLOCK = ['STUFFED! {d} roofs {a}!', '{d} with the solo block on {a}!', 'Big block by {d}!'];

interface Rally { winner: Side; text?: string; players: SimPlayer[]; kind: 'kill' | 'ace' | 'block' | 'error' }

export function simulateVolleyball(A: Lineup, B: Lineup, rng: Rng, seed: number, matchId: string): MatchResult {
  const cfg = SPORTS.volleyball;
  const sim: VolleyballSim = cfg.sim;
  const teams = { A, B };
  const m = new MatchBuilder('volleyball', rng, teams, cfg.timing);
  const s = sim.sensitivity;

  const servers = (l: Lineup) => l.players.filter((p) => p.position !== 'L');
  const rot: Record<Side, number> = { A: 0, B: 0 };
  const setter = (l: Lineup) => byPos(l, 'S')[0] ?? l.players[0]!;
  const receivers = (l: Lineup) => [...byPos(l, 'L'), ...byPos(l, 'OH')];
  const blockers = (l: Lineup) => [...byPos(l, 'MB'), ...byPos(l, 'OPP'), ...byPos(l, 'OH')].slice(0, 3);

  const rally = (serving: Side): Rally => {
    const recv = other(serving);
    const server = servers(teams[serving])[rot[serving] % servers(teams[serving]).length]!;
    const recvDig = avgSub(receivers(teams[recv]), 'DIG');
    if (rng.chance(adjust(sim.serveErrorBase, recvDig - subOf(server, 'SRV'), s))) {
      return { winner: recv, players: [server], kind: 'error', text: `Service error, ${server.name}.` };
    }
    if (rng.chance(adjust(sim.aceBase, subOf(server, 'SRV') - recvDig, s))) {
      return { winner: serving, players: [server], kind: 'ace', text: say(rng, ACE, { a: server.name }) };
    }
    let atk = recv;
    for (let touch = 0; touch < 10; touch++) {
      const off = teams[atk];
      const def = teams[other(atk)];
      const hitters = off.players.filter((p) => (sim.attackShare[p.position] ?? 0) > 0);
      const hitter = rng.weighted(hitters, (p) => (sim.attackShare[p.position] ?? 0) * Math.exp(0.03 * subOf(p, 'ATK')));
      const power = 0.75 * subOf(hitter, 'ATK') + 0.25 * subOf(setter(off), 'SET');
      const wall = blockers(def);
      const blk = avgSub(wall, 'BLK');
      const dig = avgSub(receivers(def), 'DIG');
      const pBlock = adjust(sim.blockBase, blk - power, s);
      const pKill = adjust(sim.killBase, power - (0.4 * blk + 0.6 * dig), s);
      const pErr = adjust(sim.attackErrorBase, (0.5 * blk + 0.5 * dig) - power, s * 0.5);
      const r = rng.next();
      if (r < pBlock) {
        const d = rng.weighted(wall, (p) => Math.exp(0.05 * subOf(p, 'BLK')));
        return { winner: other(atk), players: [d, hitter], kind: 'block', text: say(rng, BLOCK, { a: hitter.name, d: d.name }) };
      }
      if (r < pBlock + pErr) return { winner: other(atk), players: [hitter], kind: 'error', text: `${hitter.name} hits it long.` };
      if (r < pBlock + pErr + pKill) return { winner: atk, players: [hitter], kind: 'kill', text: say(rng, KILL, { a: hitter.name }) };
      atk = other(atk);               // dug: transition attack the other way
    }
    return { winner: atk, players: [], kind: 'error', text: 'Long rally ends with a ball-handling error.' };
  };

  const sets: Array<[number, number]> = [];
  let serving: Side = rng.chance(0.5) ? 'A' : 'B';
  const won: Record<Side, number> = { A: 0, B: 0 };

  // Rallies are generated first, then laid out over the playback: sets 1-4
  // across regulation, set 5 across the overtime segment.
  const log: Array<{ set: number; rally: Rally; pA: number; pB: number }> = [];
  for (let set = 1; won.A < 3 && won.B < 3; set++) {
    const target = set === 5 ? 15 : 25;
    const pts: Record<Side, number> = { A: 0, B: 0 };
    while (!((pts.A >= target || pts.B >= target) && Math.abs(pts.A - pts.B) >= 2)) {
      const r = rally(serving);
      pts[r.winner] += 1;
      if (r.winner !== serving) {             // side-out: rotate
        serving = r.winner;
        rot[serving] += 1;
      }
      log.push({ set, rally: r, pA: pts.A, pB: pts.B });
    }
    const w: Side = pts.A > pts.B ? 'A' : 'B';
    won[w] += 1;
    sets.push([pts.A, pts.B]);
    serving = rng.chance(0.5) ? 'A' : 'B';
  }

  const regSets = Math.min(4, sets.length);
  const regRallies = log.filter((l) => l.set <= regSets).length;
  const otRallies = log.length - regRallies;
  m.wentToOT = sets.length === 5;
  const setWins: Record<Side, number> = { A: 0, B: 0 };
  let ri = 0;
  let oi = 0;
  let curSet = 0;
  for (const l of log) {
    const seg = l.set <= regSets ? 'reg' : 'ot';
    const at = seg === 'reg' ? (ri++ + 0.5) / regRallies : 0.08 + 0.92 * ((oi++ + 0.5) / Math.max(1, otRallies));
    const period = `SET${l.set}`;
    const clock = `${l.pA}-${l.pB}`;
    if (l.set !== curSet) {
      curSet = l.set;
      if (l.set === 5) {
        m.add({ segment: 'ot', at: 0, period, clock: '0-0', type: 'ot_start', side: null,
          text: `Two sets apiece! A deciding fifth set to 15.` });
      } else {
        m.add({ segment: 'reg', at: Math.max(0, at - 0.001), period, clock: '0-0', type: 'period_start', side: null,
          text: l.set === 1 ? `First serve! ${A.name} vs ${B.name}.` : `Set ${l.set} underway. ${m.name('A')} ${setWins.A}, ${m.name('B')} ${setWins.B} in sets.` });
      }
    }
    const target = l.set === 5 ? 15 : 25;
    const crunch = Math.max(l.pA, l.pB) >= target - 5;
    const r = l.rally;
    const show = r.kind === 'ace' || r.kind === 'block' || crunch || (r.kind === 'kill' ? rng.chance(0.55) : rng.chance(0.2));
    const setOver = (l.pA >= target || l.pB >= target) && Math.abs(l.pA - l.pB) >= 2;
    if (setOver) {
      setWins[r.winner] += 1;
      m.add({ segment: seg, at, period, clock, type: 'point', side: r.winner, players: r.players,
        text: `${r.text ?? ''} ${m.name(r.winner)} take set ${l.set}, ${Math.max(l.pA, l.pB)}-${Math.min(l.pA, l.pB)}.`.trim(), points: 1, momentum: 0.35 });
      continue;
    }
    if (!show) continue;
    const lead = l.pA === l.pB ? `${l.pA}-all` : l.pA > l.pB ? `${l.pA}-${l.pB} ${m.name('A')}` : `${l.pB}-${l.pA} ${m.name('B')}`;
    const pointFor = r.winner === 'A' ? l.pA : l.pB;
    const pointAgainst = r.winner === 'A' ? l.pB : l.pA;
    const setPoint = pointFor >= target - 1 && pointFor > pointAgainst;
    m.add({ segment: seg, at, period, clock, type: 'point', side: r.winner, players: r.players,
      text: `${r.text ?? ''} ${lead}.${setPoint ? (setWins[r.winner] === 2 ? ' MATCH POINT!' : ' Set point.') : ''}`.trim(),
      momentum: r.kind === 'kill' ? 0.08 : r.kind === 'error' ? 0.05 : 0.14 });
  }
  const line = sets.map(([a, b]) => `${a}-${b}`).join(', ');
  return m.finish(matchId, seed, (w) => `FINAL: ${m.name(w)} win ${Math.max(won.A, won.B)}-${Math.min(won.A, won.B)} (${line}).`,
    `${sets[sets.length - 1]![0]}-${sets[sets.length - 1]![1]}`, `SET${sets.length}`);
}
