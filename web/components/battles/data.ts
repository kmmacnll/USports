// Draft Battles data and match simulation.
// The player pool is real U Sports athletes from the API (GET /players), valued by
// fantasy points per game (fp) this season;
// app/battles/page.tsx loads it and BattlesApp registers it with setPool().
// No fictional athletes or schools live here.

export type Pos = 'F' | 'D' | 'G';
export type Side = 'A' | 'B';

export interface Rating { l: string; v: number }
export interface Player {
  /** logo: /logos/<school slug>.png when that file exists in web/public/logos, else null. */
  id: string; first: string; last: string; school: string; schoolName: string; logo: string | null; pos: Pos;
  /** fp: fantasy points per game this season; change: fp gained over the past week. */
  fp: number; num: string; isNew: boolean; change: number | null; tint: string; ratings: Rating[];
}

/** A rated athlete as GET /players returns it. */
export interface ApiPlayer {
  athlete_id: string; first_name: string; last_name: string; school: string; school_id: string; conference: string | null;
  jersey_number: string | null; class_year: string | null; position: string; ovr: number; sub_ratings: Record<string, number>;
  is_new: boolean; games_used: number; ovr_change: number | null;
  fppg: number | null; fppg_change: number | null; fantasy_games: number;
}

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const TINTS = ['#3A7BD5', '#2E9E6A', '#8E3B46', '#C46A2B', '#6B4FB8', '#B23A48', '#5F7488', '#2F8F5B', '#2F5FA8', '#A8862B'];

/** Short school code for the cards: "UBC", "UofA", "MRU" stay, "Laval" → LAV, "Toronto Metropolitan" → TM. */
export function schoolCode(name: string) {
  const n = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^(Université|University)( de| of)?\s+/i, '').trim();
  if (/^[A-Z]{2,4}$/.test(n) || /^U(of)?[A-Z]{1,2}$/.test(n)) return n;
  const words = n.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 3 && n.length > 12 && words.every((w) => /^[A-Z]/.test(w))) return words.map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? n).replace(/[^\p{L}]/gu, '').slice(0, 3).toUpperCase();
}

/** `logos` holds the school slugs that have a PNG in web/public/logos (see app/page.tsx). */
export function fromApi(a: ApiPlayer, logos: ReadonlySet<string> = new Set()): Player | null {
  if (a.position !== 'F' && a.position !== 'D' && a.position !== 'G') return null;
  return {
    id: a.athlete_id, first: a.first_name, last: a.last_name, school: schoolCode(a.school), schoolName: a.school,
    logo: logos.has(a.school_id) ? `/logos/${encodeURIComponent(a.school_id)}.png` : null,
    pos: a.position, fp: a.fppg ?? 0, num: a.jersey_number ?? '', isNew: a.is_new, change: a.fppg_change,
    tint: TINTS[hash(a.school_id) % TINTS.length]!,
    ratings: Object.entries(a.sub_ratings).map(([l, v]) => ({ l, v })),
  };
}

// The pool the draft uses. Every athlete either side might draft is registered so player() can resolve them.
let POOL: Player[] = [];
let PI: Record<string, Player> = {};
let MEAN_FP = 1;
let TIER_CUTS = [Infinity, Infinity, Infinity];
export function setPool(list: Player[], all: Player[] = list) {
  POOL = list;
  PI = Object.fromEntries(all.map((p) => [p.id, p]));
  const fps = all.map((p) => p.fp).filter((v) => v > 0).sort((a, b) => b - a);
  MEAN_FP = fps.length ? fps.reduce((t, v) => t + v, 0) / fps.length : 1;
  // Card tiers by rank in the pool: top 5% elite, next 20% gold, next 35% silver, rest bronze.
  const at = (q: number) => fps[Math.min(fps.length - 1, Math.floor(fps.length * q))] ?? Infinity;
  TIER_CUTS = fps.length ? [at(0.05), at(0.25), at(0.6)] : [Infinity, Infinity, Infinity];
}
export type Tier = 'elite' | 'gold' | 'silver' | 'bronze';
export const tierFor = (fp: number): Tier =>
  fp > 0 && fp >= TIER_CUTS[0]! ? 'elite' : fp > 0 && fp >= TIER_CUTS[1]! ? 'gold' : fp > 0 && fp >= TIER_CUTS[2]! ? 'silver' : 'bronze';
/** Fantasy points per game as shown: one decimal. */
export const fmtFp = (fp: number) => fp.toFixed(1);
/** Sim strength on a 40-100 scale: 70 is a pool-average producer. */
const simRating = (fp: number) => Math.max(40, Math.min(100, (70 * fp) / MEAN_FP));
export const pool = () => POOL;
export const player = (id: string) => PI[id]!;

export const NEED: Record<Pos, number> = { F: 3, D: 2, G: 1 };
export const DRAFT_PICKS = 12;
export const PICK_SECONDS = 20;

/** Average fantasy points per game of a lineup, one decimal. */
export const avgFp = (ids: string[]) =>
  ids.length ? Math.round((ids.reduce((t, id) => t + player(id).fp, 0) / ids.length) * 10) / 10 : null;
const avgSim = (ids: string[]) => (ids.length ? ids.reduce((t, id) => t + simRating(player(id).fp), 0) / ids.length : null);

export const slotOpen = (picks: string[], pos: Pos) => picks.filter((id) => player(id).pos === pos).length < NEED[pos];

/** Best available player for a side; the opponent sometimes takes the second-best for variety. */
export function bestPick(picks: string[], taken: string[], opponent: boolean): string | undefined {
  const c = POOL.filter((p) => !taken.includes(p.id) && slotOpen(picks, p.pos)).sort((a, b) => b.fp - a.fp);
  if (opponent && c.length > 2 && Math.random() < 0.35) return c[1]!.id;
  return c[0]?.id;
}

// ---------- Divisions ----------
export const DIVISIONS = ['Walk-On', 'Bench', 'Starter', 'Varsity', 'All-Star', 'Captain', 'Hall of Fame'] as const;
export type Division = (typeof DIVISIONS)[number];

// ---------- People ----------
export const avatarBg = (tint: string) => `radial-gradient(circle at 35% 30%,${tint},#13203A 75%)`;
export interface Opponent { user: string; ini: string; bg: string; line: string; ai?: boolean }
/** The house AI. Ranked and friend opponents come from the API once Battles is wired to it. */
export const AI_OPP: Opponent = { user: 'VarsityHQ AI', ini: 'AI', bg: avatarBg('#5F7488'), line: 'Unranked', ai: true };

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
export function simulate(teamA: string[], teamB: string[], seed: number, userA: string, userB: string): Match {
  const rnd = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const A = lineup(teamA), B = lineup(teamB);
  const team = (s: Side) => (s === 'A' ? A : B);
  const goalie = (s: Side) => team(s)[team(s).length - 1]!;
  const skaters = (s: Side) => team(s).slice(0, -1);
  const user = (s: Side) => (s === 'A' ? userA : userB);
  const strength = (s: Side) => avgSim(team(s)) ?? 70;

  // Weighted scorer: forwards score more, stronger players score more.
  const scorer = (s: Side, not?: string) => {
    const pool = skaters(s).filter((id) => id !== not);
    const w = pool.map((id) => (player(id).pos === 'F' ? 2.2 : 1) * Math.pow(simRating(player(id).fp) / 70, 3));
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
