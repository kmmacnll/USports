// Draft Battles demo data and match simulation.
// Every athlete, school and username here is fictional (from the Claude Design handoff).
// Nothing in this module talks to the API yet: battles have no backend.

export type Pos = 'F' | 'D' | 'G';
export type Side = 'A' | 'B';

export interface Rating { l: string; v: number }
export interface Player {
  id: string; first: string; last: string; school: string; pos: Pos;
  ovr: number; num: string; isNew: boolean; tint: string; ratings: Rating[];
}

const SCHOOLS: Record<string, [string, string]> = {
  HBV: ['Harbourview', '#3A7BD5'], CDF: ['Cedar Falls', '#2E9E6A'], KGM: ['Kingsmere', '#8E3B46'],
  PAL: ['Port Alder', '#C46A2B'], STB: ['St. Brenna', '#6B4FB8'], WRD: ['Westridge', '#B23A48'],
  GRB: ['Granite Bay', '#5F7488'], PNC: ['Pinecrest', '#2F8F5B'], NGT: ['Northgate', '#2F5FA8'],
  AUB: ['Aurora Bay', '#A8862B'],
};

type Raw = [string, string, string, string, Pos, number, string, number?];
const RAW: Raw[] = [
  ['p1', 'Maya', 'Lindqvist', 'HBV', 'F', 88, '19'], ['p2', 'Chloé', 'Barrette', 'KGM', 'F', 86, '7'],
  ['p3', 'Aisha', 'Rahman', 'CDF', 'F', 84, '22'], ['p4', 'Brooke', 'Tanaka', 'STB', 'F', 82, '11'],
  ['p5', 'Sofia', 'Marchetti', 'WRD', 'F', 79, '16'], ['p6', 'Hannah', 'Okoro', 'PAL', 'F', 77, '9'],
  ['p7', 'Léa', 'Fournier', 'NGT', 'F', 74, '27'], ['p8', 'Jess', 'Whitford', 'GRB', 'F', 71, '14'],
  ['p9', 'Nora', 'Kaplan', 'PNC', 'F', 68, '21', 1], ['p10', 'Ellie', 'Dawson', 'AUB', 'F', 63, '33'],
  ['p11', 'Kenzie', 'MacLeod', 'HBV', 'D', 85, '4'], ['p12', 'Priya', 'Sandhu', 'NGT', 'D', 81, '2'],
  ['p13', 'Rachel', 'Gauthier', 'KGM', 'D', 78, '5'], ['p14', 'Tess', 'Holloway', 'CDF', 'D', 73, '8'],
  ['p15', 'Zoe', 'Fraser', 'STB', 'D', 69, '44', 1], ['p16', 'Amara', 'Diallo', 'PAL', 'D', 62, '3'],
  ['p17', 'Julia', 'Novak', 'WRD', 'G', 87, '31'], ['p18', 'Camille', 'Roy', 'PNC', 'G', 80, '35'],
  ['p19', 'Sam', 'Ito', 'AUB', 'G', 72, '30'], ['p20', 'Erin', 'Walsh', 'GRB', 'G', 64, '1'],
];

const OFFSETS: Record<Pos, [string, number][]> = {
  F: [['SHT', 4], ['PAS', 1], ['SKT', 2], ['DEF', -12], ['PHY', -5]],
  D: [['SHT', -8], ['PAS', 1], ['SKT', -1], ['DEF', 5], ['PHY', 3]],
  G: [['REF', 3], ['POS', 1], ['HND', -2], ['REB', 0], ['PHY', -6]],
};

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export const PLAYERS: Player[] = RAW.map(([id, first, last, school, pos, ovr, num, isNew]) => {
  const h = hash(id + last);
  return {
    id, first, last, school, pos, ovr, num, isNew: !!isNew, tint: SCHOOLS[school]![1],
    ratings: OFFSETS[pos].map(([l, o], i) => ({ l, v: Math.max(40, Math.min(99, ovr + o + ((h >> (i * 4)) % 7) - 3)) })),
  };
});
export const PI: Record<string, Player> = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
export const player = (id: string) => PI[id]!;

export const NEED: Record<Pos, number> = { F: 3, D: 2, G: 1 };
export const DRAFT_PICKS = 12;
export const PICK_SECONDS = 20;

export const avgOvr = (ids: string[]) =>
  ids.length ? Math.round(ids.reduce((t, id) => t + player(id).ovr, 0) / ids.length) : null;

export const slotOpen = (picks: string[], pos: Pos) => picks.filter((id) => player(id).pos === pos).length < NEED[pos];

/** Best available player for a side; the opponent sometimes takes the second-best for variety. */
export function bestPick(picks: string[], taken: string[], opponent: boolean): string | undefined {
  const c = PLAYERS.filter((p) => !taken.includes(p.id) && slotOpen(picks, p.pos)).sort((a, b) => b.ovr - a.ovr);
  if (opponent && c.length > 2 && Math.random() < 0.35) return c[1]!.id;
  return c[0]?.id;
}

// ---------- Divisions ----------
export const DIVISIONS = ['Walk-On', 'Bench', 'Starter', 'Varsity', 'All-Star', 'Captain', 'Hall of Fame'] as const;
export type Division = (typeof DIVISIONS)[number];

// ---------- People ----------
const TINTS = ['#3A7BD5', '#2E9E6A', '#8E3B46', '#C46A2B', '#6B4FB8', '#B23A48', '#5F7488', '#2F8F5B', '#2F5FA8', '#A8862B'];
export const avatarBg = (tint: string) => `radial-gradient(circle at 35% 30%,${tint},#13203A 75%)`;
export const avatarAt = (i: number) => avatarBg(TINTS[i % TINTS.length]!);
export const ME = { user: 'kmac', ini: 'KM', bg: 'radial-gradient(circle at 35% 30%,#2F5596,#0C1628 75%)', div: 'Varsity II', elo: 1482 };

export interface Opponent { user: string; ini: string; bg: string; line: string; ai?: boolean }
export const JAYBIRD: Opponent = { user: 'jaybird', ini: 'JB', bg: avatarBg('#3A7BD5'), line: 'Varsity I · 1,531' };
export const AI_OPP: Opponent = { user: 'VarsityHQ AI', ini: 'AI', bg: avatarBg('#5F7488'), line: 'Unranked', ai: true };

export interface Friend { name: string; ini: string; tint: string; sub: string; online: boolean; busy: boolean }
export const FRIENDS: Friend[] = [
  { name: 'jaybird', ini: 'JB', tint: '#3A7BD5', sub: 'Varsity I · 1,531', online: true, busy: false },
  { name: 'jay_dangles', ini: 'JD', tint: '#2E9E6A', sub: 'Starter III · 1,204', online: true, busy: false },
  { name: 'jaylynn.k', ini: 'JK', tint: '#6B4FB8', sub: 'All-Star II · 1,702', online: false, busy: true },
  { name: 'jayden_ice', ini: 'JI', tint: '#C46A2B', sub: 'Bench I · 980', online: false, busy: false },
];

export interface InboxItem {
  id: string; title: string; sub: string; chip: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'; ini: string; tint: number;
}
export const INBOX: InboxItem[] = [
  { id: 'n1', title: '@jaybird challenged you', sub: "Hockey · Women's · Unranked · expires in 1 min", chip: 'PENDING', ini: 'JB', tint: 0 },
  { id: 'n2', title: '@puckluck accepted', sub: "You won 5–2 · Basketball · Men's", chip: 'ACCEPTED', ini: 'PL', tint: 1 },
  { id: 'n3', title: '@topshelf_tess declined', sub: "Soccer · Women's", chip: 'DECLINED', ini: 'TT', tint: 4 },
  { id: 'n4', title: '@five_hole_fi challenged you', sub: "Hockey · Men's · yesterday", chip: 'EXPIRED', ini: 'FF', tint: 2 },
  { id: 'n5', title: '@dangle_dani accepted', sub: "Lost 2–3 · Volleyball · Women's", chip: 'ACCEPTED', ini: 'DD', tint: 5 },
  { id: 'n6', title: '@icecold_ava challenged you', sub: 'Football · 2 days ago', chip: 'EXPIRED', ini: 'IA', tint: 3 },
];

export const LADDER_USERS = ['topshelf_tess', 'puckluck', 'five_hole_fi', 'dangle_dani', 'icecold_ava', 'glovesave', 'kmac', 'snipe_city', 'bardown_bea', 'rinkrat_rae', 'slapshot_sky', 'pk_queen', 'breakaway_b', 'hatty_hannah', 'blueline_bo', 'crossbar_cat', 'wrister_wen', 'top_cheese', 'offside_olive', 'zamboni_zoe', 'penalty_pip', 'dump_n_chase', 'clapper_cleo', 'backcheck_bri', 'sin_bin_sam', 'faceoff_fay', 'cherrypick_cj', 'icing_iris', 'lazy_pass_lu', 'pylon_pat'];

export const SPORTS = [
  { id: 'hockey', name: 'Hockey', icon: 'sports_hockey', formation: '3F · 2D · 1G' },
  { id: 'basketball', name: 'Basketball', icon: 'sports_basketball', formation: '2G · 2F · 1C' },
  { id: 'soccer', name: 'Soccer', icon: 'sports_soccer', formation: 'GK · 2DEF · 2MID · 2FWD' },
  { id: 'volleyball', name: 'Volleyball', icon: 'sports_volleyball', formation: 'S · 2OH · MB · OPP · L' },
  { id: 'football', name: 'Football', icon: 'sports_football', formation: 'QB · RB · 2WR · 2DEF' },
] as const;
export type SportId = (typeof SPORTS)[number]['id'];

// ---------- Match simulation ----------
// Sim time runs in "ticks": three 50-tick periods, then a 3-on-3 OT from tick 152.
export type EventType = 'period_start' | 'period_end' | 'goal' | 'shot' | 'save' | 'turnover' | 'penalty' | 'sub' | 'highlight' | 'ot_start' | 'final';
export interface MatchEvent {
  id: string; t: number; type: EventType; side: Side | null; playerIds: string[];
  text: string; meta: string; scoreA: number; scoreB: number; momentum: number;
  period: 1 | 2 | 3 | 'OT'; clock: string;
}
export interface Match { events: MatchEvent[]; end: number; scoreA: number; scoreB: number; ot: boolean; winner: Side }

export const OT_START = 152;
export const periodOf = (t: number): MatchEvent['period'] => (t < 50 ? 1 : t < 100 ? 2 : t < 150 ? 3 : 'OT');
export function clockAt(t: number) {
  let s: number;
  if (t >= 150) s = t < OT_START ? 300 : Math.max(0, 300 * (1 - (t - OT_START) / 45));
  else { const p = Math.floor(Math.min(t, 149.9) / 50); s = Math.max(0, 1200 * (1 - (t - p * 50) / 50)); }
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function rng(seed: number) {
  let s = (seed % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const SHOT = ['wrister from the slot', 'snaps one high', 'one-timer off the rush', 'backhand in tight', 'shot from the point'];
const SAVE = ['kicks it aside', 'gloves it down', 'smothers the rebound', 'squares up, blocker save'];
const TURNOVER = ['picks the pocket at the blue line', 'intercepts a lazy pass', 'strips the puck behind the net'];
const GOAL = ['snipes it bar-down', 'tips home a point shot', 'walks in alone, five-hole', 'rips one from the point', 'finishes the give-and-go', 'buries the rebound', 'roofs it short side'];
const PENALTY = ['tripping', 'hooking', 'interference', 'slashing'];

/** Orders a lineup as [F, F, F, D, D, G] (skaters first, goalie last). */
const lineup = (ids: string[]) => {
  const by = (pos: Pos) => ids.filter((id) => player(id).pos === pos);
  return [...by('F'), ...by('D'), ...by('G')];
};

/** Builds the full event stream for a drafted matchup. Deterministic for a given seed. */
export function simulate(teamA: string[], teamB: string[], seed: number, userA = '@kmac', userB = '@jaybird'): Match {
  const rnd = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const A = lineup(teamA), B = lineup(teamB);
  const team = (s: Side) => (s === 'A' ? A : B);
  const goalie = (s: Side) => team(s)[team(s).length - 1]!;
  const skaters = (s: Side) => team(s).slice(0, -1);
  const user = (s: Side) => (s === 'A' ? userA : userB);
  const strength = (s: Side) => avgOvr(team(s)) ?? 70;

  // Weighted scorer: forwards score more, stronger players score more.
  const scorer = (s: Side, not?: string) => {
    const pool = skaters(s).filter((id) => id !== not);
    const w = pool.map((id) => (player(id).pos === 'F' ? 2.2 : 1) * Math.pow(player(id).ovr / 70, 3));
    let r = rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]!; if (r <= 0) return pool[i]!; }
    return pool[pool.length - 1]!;
  };

  type Seed = { t: number; type: EventType; side: Side | null; ids: string[]; text: string; meta?: string };
  const S: Seed[] = [
    { t: 0, type: 'period_start', side: null, ids: [], text: '1st period · puck drop' },
    { t: 49.6, type: 'period_end', side: null, ids: [], text: 'End of 1st' },
    { t: 50.3, type: 'period_start', side: null, ids: [], text: '2nd period' },
    { t: 99.6, type: 'period_end', side: null, ids: [], text: 'End of 2nd' },
    { t: 100.3, type: 'period_start', side: null, ids: [], text: '3rd period' },
  ];

  // Regulation goals: 2–5 per side, tilted by the strength gap.
  const diff = (strength('A') - strength('B')) / 10;
  const goals = (s: Side) => Math.max(1, Math.min(6, Math.round(2.6 + (s === 'A' ? diff : -diff) + (rnd() * 2.4 - 1.2))));
  const busy: number[] = [];
  const freeTime = (lo: number, hi: number) => {
    for (let k = 0; k < 40; k++) {
      const t = lo + rnd() * (hi - lo);
      const inPeriodGap = [49, 50.3, 99, 100.3].some((b) => Math.abs(t - b) < 2.5);
      if (!inPeriodGap && busy.every((b) => Math.abs(b - t) > 4)) { busy.push(t); return +t.toFixed(1); }
    }
    return +(lo + rnd() * (hi - lo)).toFixed(1);
  };
  const goalSeed = (s: Side, t: number, text?: string): Seed => {
    const g = scorer(s), a = scorer(s, g);
    return { t, type: 'goal', side: s, ids: [g, a], text: text ?? `${player(g).last} ${pick(GOAL)}`, meta: `Assist: ${player(a).last}` };
  };
  (['A', 'B'] as Side[]).forEach((s) => {
    for (let i = goals(s); i > 0; i--) S.push(goalSeed(s, freeTime(4, 147)));
    const p = pick(skaters(s));
    const other: Side = s === 'A' ? 'B' : 'A';
    S.push({ t: freeTime(8, 145), type: 'penalty', side: s, ids: [p], text: `${player(p).last} · 2 min ${pick(PENALTY)}. ${user(other)} power play` });
    const g = goalie(s), shooter = pick(skaters(other));
    S.push({ t: freeTime(10, 146), type: 'highlight', side: s, ids: [g], text: `${player(g).last} robs ${player(shooter).last} on a 2-on-0` });
  });

  let a = S.filter((e) => e.type === 'goal' && e.side === 'A').length;
  let b = S.filter((e) => e.type === 'goal' && e.side === 'B').length;
  let end = 150, ot = false;
  S.push({ t: 149.6, type: 'period_end', side: null, ids: [], text: a === b ? 'End of regulation' : 'End of 3rd' });
  if (a === b) {
    ot = true;
    S.push({ t: OT_START, type: 'ot_start', side: null, ids: [], text: '3-on-3 · next goal wins' });
    const pA = strength('A') / (strength('A') + strength('B'));
    const s: Side = rnd() < pA ? 'A' : 'B';
    const t = +(160 + rnd() * 26).toFixed(1);
    const g = goalSeed(s, t);
    g.text = `${player(g.ids[0]!).last} wins it in overtime!`;
    S.push(g);
    if (s === 'A') a++; else b++;
    end = t + 1.5;
  }
  S.push({ t: end, type: 'final', side: null, ids: [], text: ot ? 'Final · OT' : 'Final' });

  // Filler: shots, saves, turnovers and line changes between the scripted moments.
  const near = (t: number) => S.some((e) => Math.abs(e.t - t) < 1.9) || (t > 148.5 && t < OT_START + 2) || t > end - 3;
  for (let t = 3; t < end - 3; t += 2.7 + rnd() * 1.9) {
    if (near(t) || near(t + 1.2)) continue;
    const side: Side = rnd() < 0.5 ? 'A' : 'B';
    const other: Side = side === 'A' ? 'B' : 'A';
    const sk = pick(skaters(side));
    const r = rnd();
    if (r < 0.58) {
      S.push({ t, type: 'shot', side, ids: [sk], text: `${player(sk).last} ${pick(SHOT)}` });
      const g = goalie(other);
      S.push({ t: t + 1.1, type: 'save', side: other, ids: [g], text: `${player(g).last} ${pick(SAVE)}` });
    } else if (r < 0.86) S.push({ t, type: 'turnover', side, ids: [sk], text: `${player(sk).last} ${pick(TURNOVER)}` });
    else S.push({ t, type: 'sub', side, ids: [], text: 'Line change on the fly' });
  }

  S.sort((x, y) => x.t - y.t);
  let sa = 0, sb = 0, m = 0;
  const events = S.map((e, i): MatchEvent => {
    const sign = e.side === 'A' ? 1 : e.side === 'B' ? -1 : 0;
    m *= 0.86;
    if (e.type === 'goal') { if (e.side === 'A') sa++; else sb++; m += 0.55 * sign; }
    else if (e.type === 'shot') m += 0.09 * sign;
    else if (e.type === 'save') m += 0.05 * sign;
    else if (e.type === 'turnover') m += 0.1 * sign;
    else if (e.type === 'penalty') m -= 0.18 * sign;
    else if (e.type === 'highlight') m += 0.22 * sign;
    m = Math.max(-1, Math.min(1, m));
    return {
      id: `e${i}`, t: e.t, type: e.type, side: e.side, playerIds: e.ids, text: e.text, meta: e.meta ?? '',
      scoreA: sa, scoreB: sb, momentum: +m.toFixed(2), period: periodOf(e.t),
      clock: e.type === 'period_end' ? '0:00' : clockAt(e.t),
    };
  });
  return { events, end, scoreA: sa, scoreB: sb, ot, winner: sa > sb ? 'A' : 'B' };
}

/** Player of the match: most points on the winning side, goalie if no skater scored. */
export function playerOfMatch(match: Match) {
  const pts: Record<string, { g: number; a: number; sog: number }> = {};
  for (const e of match.events) {
    if (e.side !== match.winner) continue;
    const [p0, p1] = e.playerIds;
    if (e.type === 'goal' && p0) { (pts[p0] ??= { g: 0, a: 0, sog: 0 }).g++; (pts[p0]).sog++; if (p1) (pts[p1] ??= { g: 0, a: 0, sog: 0 }).a++; }
    if (e.type === 'shot' && p0) (pts[p0] ??= { g: 0, a: 0, sog: 0 }).sog++;
  }
  const ranked = Object.entries(pts).sort(([, x], [, y]) => (y.g * 2 + y.a) - (x.g * 2 + x.a) || y.g - x.g);
  const winnerGoal = [...match.events].reverse().find((e) => e.type === 'goal');
  const top = ranked[0];
  if (top && top[1].g + top[1].a > 0) {
    const [id, s] = top;
    const parts = [`${s.g}G`, `${s.a}A`, `${s.sog} SOG`];
    if (match.ot && winnerGoal?.playerIds[0] === id) parts.push('OT winner');
    return { id, line: parts.join(' · ') };
  }
  const g = match.events.find((e) => e.type === 'save' && e.side === match.winner)?.playerIds[0];
  const saves = match.events.filter((e) => e.type === 'save' && e.side === match.winner).length;
  return { id: g ?? Object.keys(pts)[0] ?? 'p1', line: `${saves} saves` };
}
