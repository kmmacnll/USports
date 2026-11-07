/**
 * Test fixtures only: fake U SPORTS-shaped data with fictional
 * universities, athletes and two seasons of box scores for every battle sport,
 * using the same canonical stat keys the pipeline writes. Every athlete has a
 * hidden talent z ~ N(0,1) that drives their stats, so ratings can be checked
 * against it. Deterministic for a given seed.
 */
import { createRng, type Rng } from '../src/battles/rng.js';

export interface FakeAthlete {
  key: string;
  first: string;
  last: string;
  uni: string;
  sport: string;
  position: string;       // raw roster position
  positions: string[];    // normalised tokens
  jersey: string;
  classYear: string;
  talent: number;
  plays: boolean;         // false = freshman with no games yet (NEW)
}
export interface FakeGame {
  key: string;
  sport: string;
  season: string;
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}
export interface FakeLine { athlete: string; game: string; uni: string; opp: string; starter: boolean; position: string | null; stats: Record<string, number> }
export interface FakeData { universities: Array<{ slug: string; name: string; conference: string }>; athletes: FakeAthlete[]; games: FakeGame[]; lines: FakeLine[] }

const SCHOOLS = ['Northgate', 'Lakeshore', 'Pinecrest', 'Riverside', 'Summit Hill', 'Harbourview', 'Maple Ridge',
  'Stonebridge', 'Westbrook', 'Eastvale', 'Granite Falls', 'Silver Lake', 'Cedar Point', 'Foxhollow'];
const CONFERENCES = ['OUA', 'CW', 'RSEQ', 'AUS'];
const FIRST = ['Aiden', 'Maya', 'Noah', 'Zara', 'Liam', 'Chloe', 'Ethan', 'Priya', 'Lucas', 'Amara', 'Owen', 'Sofia',
  'Mateo', 'Leah', 'Kai', 'Nadia', 'Theo', 'Ivy', 'Jonah', 'Elena', 'Malik', 'Grace', 'Felix', 'Hana', 'Rowan', 'Ines',
  'Declan', 'Talia', 'Jasper', 'Mila', 'Emeka', 'Sana', 'Callum', 'Rhea', 'Tobias', 'Wren'];
const LAST = ['Okafor', 'Tremblay', 'Nguyen', 'Campbell', 'Singh', 'Leblanc', 'Martin', 'Osei', 'Fraser', 'Kowalski',
  'Bouchard', 'Haddad', 'MacLeod', 'Ferreira', 'Chen', 'Gagnon', 'Mensah', 'Roy', 'Park', 'Sullivan', 'Bergeron',
  'Adeyemi', 'Lindqvist', 'Moreau', 'Patel', 'Duchesne', 'Abara', 'Kim', 'Novak', 'Côté', 'Ibrahim', 'Walsh', 'Pelletier',
  'Yamada', 'Oyelaran', 'Desrosiers', 'Haas', 'Mbeki', 'Quinn', 'Larsen'];

interface RosterSpec { position: string; count: number; starters: number }
const ROSTERS: Record<string, RosterSpec[]> = {
  hockey: [{ position: 'C', count: 4, starters: 4 }, { position: 'LW', count: 4, starters: 4 }, { position: 'RW', count: 5, starters: 4 },
    { position: 'D', count: 7, starters: 6 }, { position: 'G', count: 2, starters: 1 }],
  basketball: [{ position: 'G', count: 5, starters: 2 }, { position: 'F', count: 5, starters: 2 }, { position: 'C', count: 2, starters: 1 }],
  soccer: [{ position: 'GK', count: 2, starters: 1 }, { position: 'D', count: 6, starters: 4 }, { position: 'M', count: 6, starters: 4 },
    { position: 'F', count: 4, starters: 2 }],
  volleyball: [{ position: 'S', count: 2, starters: 1 }, { position: 'OH', count: 4, starters: 2 }, { position: 'MB', count: 3, starters: 2 },
    { position: 'OPP', count: 2, starters: 1 }, { position: 'L', count: 2, starters: 1 }],
  football: [{ position: 'QB', count: 2, starters: 1 }, { position: 'RB', count: 3, starters: 1 }, { position: 'WR', count: 6, starters: 4 },
    { position: 'LB', count: 6, starters: 4 }, { position: 'DB', count: 7, starters: 5 }, { position: 'DL', count: 5, starters: 3 },
    { position: 'K', count: 1, starters: 1 }, { position: 'OL', count: 4, starters: 4 }],
};
export const FAKE_SPORT_CODES: Record<string, string> = {
  usports_mhk: 'hockey', usports_whk: 'hockey', usports_mbk: 'basketball', usports_wbk: 'basketball',
  usports_msoc: 'soccer', usports_wsoc: 'soccer', usports_mvb: 'volleyball', usports_wvb: 'volleyball', usports_fb: 'football',
};
const SEASON_GAMES: Record<string, [number, number]> = {   // [2025-26, 2026-27] games per team
  hockey: [20, 8], basketball: [18, 6], soccer: [14, 12], volleyball: [18, 6], football: [8, 8],
};

const POS_TOKENS: Record<string, string[]> = { LW: ['LW'], RW: ['RW'], LB: ['LB'], DB: ['DB'], DL: ['DL'], OL: ['OL'], K: ['K'] };

type Team = { uni: string; players: FakeAthlete[] };
type Gen = (rng: Rng, team: Team, opp: Team) => { score: number; lines: Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>; ctx?: unknown };

const pois = (rng: Rng, l: number) => rng.poisson(Math.max(0.01, l));
const lift = (z: number, s = 0.2) => Math.max(0.2, 1 + s * z);
const strength = (ps: FakeAthlete[]) => (ps.length ? ps.reduce((s, p) => s + p.talent, 0) / ps.length : 0);
const starters = (team: Team, sport: string) => {
  const out: FakeAthlete[] = [];
  for (const spec of ROSTERS[sport]!) {
    out.push(...team.players.filter((p) => p.position === spec.position && p.plays)
      .sort((a, b) => b.talent - a.talent).slice(0, spec.starters));
  }
  return out;
};
function distribute(rng: Rng, n: number, ps: FakeAthlete[], w: (p: FakeAthlete) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < n && ps.length; i++) {
    const p = rng.weighted(ps, w);
    m.set(p.key, (m.get(p.key) ?? 0) + 1);
  }
  return m;
}

// ------------------------------------------------------------------ per-sport game generators

/** Generators return each side's score and lines; two-team games are generated jointly. */
function hockeyGame(rng: Rng, home: Team, away: Team) {
  const res = [home, away].map((t) => ({ t, xs: starters(t, 'hockey') }));
  const goalsOf: number[] = [];
  const shotsOf: number[] = [];
  const out: Array<Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>> = [[], []];
  for (let i = 0; i < 2; i++) {
    const me = res[i]!.xs;
    const opp = res[1 - i]!.xs;
    const off = strength(me.filter((p) => p.position !== 'G' && p.position !== 'D'));
    const def = strength(opp.filter((p) => p.position === 'D')) * 0.5 + strength(opp.filter((p) => p.position === 'G'));
    goalsOf[i] = pois(rng, 2.9 * Math.exp(0.22 * off - 0.22 * def));
    shotsOf[i] = Math.max(goalsOf[i]! + 8, pois(rng, 29 * Math.exp(0.08 * off)));
  }
  for (let i = 0; i < 2; i++) {
    const me = res[i]!.xs;
    const skaters = me.filter((p) => p.position !== 'G');
    const scorers = distribute(rng, goalsOf[i]!, skaters, (p) => (p.position === 'D' ? 0.35 : 1) * Math.exp(0.7 * p.talent));
    const helpers = distribute(rng, Math.round(goalsOf[i]! * 1.6), skaters, (p) => (p.position === 'D' ? 0.8 : 1) * Math.exp(0.6 * p.talent));
    const shooters = distribute(rng, shotsOf[i]! - goalsOf[i]!, skaters, (p) => (p.position === 'D' ? 0.55 : 1) * Math.exp(0.35 * p.talent));
    const diff = goalsOf[i]! - goalsOf[1 - i]!;
    for (const p of skaters) {
      const g = scorers.get(p.key) ?? 0;
      const stats: Record<string, number> = {
        goals: g, assists: helpers.get(p.key) ?? 0, shots: g + (shooters.get(p.key) ?? 0),
        plus_minus: Math.round(diff * 0.4 + rng.normal(0.25 * p.talent, 1)), penalty_minutes: rng.chance(0.18) ? 2 : 0,
        minutes: Math.round(rng.range(13, 21) + 2 * p.talent),
      };
      if (p.position === 'C') {
        stats.faceoffs_total = pois(rng, 14);
        stats.faceoffs_won = Math.round(stats.faceoffs_total * Math.min(0.75, Math.max(0.3, 0.5 + 0.04 * p.talent + rng.normal(0, 0.05))));
      }
      out[i]!.push({ athlete: p.key, starter: true, position: rng.chance(0.7) ? p.position : null, stats });
    }
    const goalie = me.find((p) => p.position === 'G')!;
    const against = shotsOf[1 - i]!;
    const ga = goalsOf[1 - i]!;
    out[i]!.push({ athlete: goalie.key, starter: true, position: 'G',
      stats: { saves: against - ga, goals_allowed: ga, shots_against: against, minutes: 60 } });
  }
  let [hs, as] = goalsOf as [number, number];
  if (hs === as) (rng.chance(0.5) ? (hs += 1) : (as += 1));   // OT winner, not credited to a player
  return { scores: [hs, as] as [number, number], lines: out };
}

function basketballGame(rng: Rng, home: Team, away: Team) {
  const out: Array<Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>> = [[], []];
  const scores: [number, number] = [0, 0];
  const sides = [home, away];
  for (let i = 0; i < 2; i++) {
    const team = sides[i]!;
    const oppDef = strength(starters(sides[1 - i]!, 'basketball'));
    const rotation = team.players.filter((p) => p.plays).sort((a, b) => b.talent - a.talent).slice(0, 10);
    rotation.forEach((p, idx) => {
      const min = Math.max(4, Math.round(rng.normal(idx < 5 ? 30 : idx < 8 ? 16 : 7, 3)));
      const f = min / 40;
      const share3 = p.position === 'G' ? 0.45 : p.position === 'F' ? 0.3 : 0.05;
      const fga = pois(rng, f * 15 * lift(p.talent, 0.15));
      const tpa = Math.round(fga * share3);
      const tpm = Math.round(tpa * Math.min(0.55, Math.max(0.15, 0.33 + 0.04 * p.talent - 0.01 * oppDef + rng.normal(0, 0.08))));
      const twa = fga - tpa;
      const twm = Math.round(twa * Math.min(0.75, Math.max(0.25, 0.49 + 0.04 * p.talent - 0.015 * oppDef + rng.normal(0, 0.08))));
      const fta = pois(rng, f * 5 * lift(p.talent, 0.1));
      const ftm = Math.round(fta * Math.min(0.95, Math.max(0.4, 0.72 + 0.04 * p.talent)));
      const reb = pois(rng, f * (p.position === 'G' ? 4 : p.position === 'F' ? 7 : 10.5) * lift(p.talent));
      const stats = {
        minutes: min, field_goals_made: twm + tpm, field_goals_attempted: fga, three_pointers_made: tpm,
        three_pointers_attempted: tpa, free_throws_made: ftm, free_throws_attempted: fta,
        points: 2 * twm + 3 * tpm + ftm, rebounds: reb, offensive_rebounds: Math.round(reb * 0.3),
        defensive_rebounds: reb - Math.round(reb * 0.3),
        assists: pois(rng, f * (p.position === 'G' ? 6 : p.position === 'F' ? 3 : 2) * lift(p.talent, 0.25)),
        steals: pois(rng, f * 1.6 * lift(p.talent)), blocks: pois(rng, f * (p.position === 'C' ? 2.2 : p.position === 'F' ? 0.8 : 0.3) * lift(p.talent)),
        turnovers: pois(rng, f * 2.6 * lift(-p.talent, 0.1)), personal_fouls: pois(rng, f * 3.2),
      };
      scores[i as 0 | 1] += stats.points;
      out[i]!.push({ athlete: p.key, starter: idx < 5, position: null, stats });
    });
  }
  if (scores[0] === scores[1]) scores[rng.int(2) as 0 | 1] += 2;
  return { scores, lines: out };
}

function soccerGame(rng: Rng, home: Team, away: Team) {
  const out: Array<Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>> = [[], []];
  const xs = [home, away].map((t) => starters(t, 'soccer'));
  const goals: number[] = [];
  const shots: number[] = [];
  const sog: number[] = [];
  for (let i = 0; i < 2; i++) {
    const att = strength(xs[i]!.filter((p) => p.position === 'F' || p.position === 'M'));
    const def = strength(xs[1 - i]!.filter((p) => p.position === 'D' || p.position === 'GK'));
    goals[i] = pois(rng, 1.4 * Math.exp(0.3 * att - 0.3 * def));
    shots[i] = Math.max(goals[i]! + 3, pois(rng, 12 * Math.exp(0.1 * att)));
    sog[i] = Math.max(goals[i]!, Math.round(shots[i]! * rng.range(0.35, 0.5)));
  }
  for (let i = 0; i < 2; i++) {
    const field = xs[i]!.filter((p) => p.position !== 'GK');
    const posW = (p: FakeAthlete) => (p.position === 'F' ? 3 : p.position === 'M' ? 1.4 : 0.35);
    const sc = distribute(rng, goals[i]!, field, (p) => posW(p) * Math.exp(0.7 * p.talent));
    const as = distribute(rng, Math.round(goals[i]! * 0.8), field, (p) => (p.position === 'M' ? 2 : 1) * Math.exp(0.6 * p.talent));
    const sh = distribute(rng, shots[i]! - goals[i]!, field, (p) => posW(p) * Math.exp(0.3 * p.talent));
    const onT = distribute(rng, sog[i]! - goals[i]!, field, (p) => posW(p) * Math.exp(0.4 * p.talent));
    for (const p of field) {
      const g = sc.get(p.key) ?? 0;
      const s = g + (sh.get(p.key) ?? 0);
      out[i]!.push({ athlete: p.key, starter: true, position: p.position, stats: {
        goals: g, assists: as.get(p.key) ?? 0, shots: s, shots_on_goal: Math.min(s, g + (onT.get(p.key) ?? 0)),
        minutes: Math.max(20, Math.round(rng.normal(80 + 4 * p.talent, 8))), yellow_cards: rng.chance(0.08) ? 1 : 0, red_cards: rng.chance(0.004) ? 1 : 0 } });
    }
    const gk = xs[i]!.find((p) => p.position === 'GK')!;
    out[i]!.push({ athlete: gk.key, starter: true, position: 'GK', stats: {
      saves: sog[1 - i]! - goals[1 - i]!, goals_against: goals[1 - i]!, shots_on_goal_against: sog[1 - i]!, minutes: 90 } });
  }
  return { scores: [goals[0]!, goals[1]!] as [number, number], lines: out };
}

function volleyballGame(rng: Rng, home: Team, away: Team) {
  const out: Array<Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>> = [[], []];
  const xs = [home, away].map((t) => starters(t, 'volleyball'));
  const d = strength(xs[0]!) - strength(xs[1]!);
  const won = [0, 0];
  while (won[0]! < 3 && won[1]! < 3) won[rng.chance(1 / (1 + Math.exp(-1.6 * d))) ? 0 : 1]!++;
  const sets = won[0]! + won[1]!;
  const rate: Record<string, Record<string, number>> = {
    S: { kills: 0.5, digs: 1.5, assists: 10.5, blocks: 0.3, aces: 0.3 },
    OH: { kills: 3.3, digs: 2.0, assists: 0.2, blocks: 0.35, aces: 0.25 },
    MB: { kills: 1.9, digs: 0.5, assists: 0.1, blocks: 0.95, aces: 0.2 },
    OPP: { kills: 3.6, digs: 1.0, assists: 0.1, blocks: 0.55, aces: 0.25 },
    L: { kills: 0, digs: 3.1, assists: 0.6, blocks: 0, aces: 0.05 },
  };
  for (let i = 0; i < 2; i++) {
    for (const p of xs[i]!) {
      const r = rate[p.position]!;
      const l = (x: number, s = 0.2) => pois(rng, x * sets * lift(p.talent, s));
      const kills = l(r.kills!);
      const attacks = p.position === 'L' ? 0 : Math.round(kills / Math.max(0.3, 0.42 + 0.03 * p.talent) + rng.range(0, 2));
      const blocks = l(r.blocks!);
      out[i]!.push({ athlete: p.key, starter: true, position: null, stats: {
        sets_played: sets, kills, attack_errors: Math.round(attacks * Math.max(0.03, 0.14 - 0.02 * p.talent)), total_attacks: attacks,
        assists: l(r.assists!, 0.15), service_aces: l(r.aces!), service_errors: pois(rng, 0.35 * sets * lift(-p.talent, 0.15)),
        digs: l(r.digs!), block_solos: Math.round(blocks * 0.3), block_assists: blocks - Math.round(blocks * 0.3),
        reception_errors: pois(rng, (p.position === 'OH' || p.position === 'L' ? 0.25 : 0.05) * sets * lift(-p.talent, 0.2)),
        ball_handling_errors: pois(rng, (p.position === 'S' ? 0.1 : 0.02) * sets) } });
    }
  }
  return { scores: [won[0]!, won[1]!] as [number, number], lines: out };
}

function footballGame(rng: Rng, home: Team, away: Team) {
  const out: Array<Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>> = [[], []];
  const xs = [home, away].map((t) => starters(t, 'football'));
  const scores: [number, number] = [0, 0];
  const isDef = (p: FakeAthlete) => ['LB', 'DB', 'DL'].includes(p.position);
  for (let i = 0; i < 2; i++) {
    const me = xs[i]!;
    const off = strength(me.filter((p) => ['QB', 'RB', 'WR'].includes(p.position)));
    const def = strength(xs[1 - i]!.filter(isDef));
    const qb = me.find((p) => p.position === 'QB')!;
    const rb = me.find((p) => p.position === 'RB')!;
    const wrs = me.filter((p) => p.position === 'WR');
    const tds = pois(rng, 2.6 * Math.exp(0.25 * (off + qb.talent * 0.5) - 0.25 * def));
    const fgs = pois(rng, 1.6);
    scores[i] = 7 * tds + 3 * fgs + (rng.chance(0.3) ? 1 : 0);
    const passTd = Math.round(tds * 0.6);
    const att = pois(rng, 32);
    const comp = Math.round(att * Math.min(0.8, Math.max(0.4, 0.6 + 0.05 * qb.talent - 0.02 * def + rng.normal(0, 0.05))));
    const recBy = distribute(rng, comp, [...wrs, rb], (p) => (p === rb ? 0.5 : 1) * Math.exp(0.5 * p.talent));
    const recTd = distribute(rng, passTd, wrs, (p) => Math.exp(0.6 * p.talent));
    let passYds = 0;
    for (const p of [...wrs, rb]) {
      const rec = recBy.get(p.key) ?? 0;
      const yds = Math.round(rec * Math.max(4, rng.normal(p === rb ? 8 : 13 + 1.8 * p.talent, 2)));
      passYds += yds;
      const stats: Record<string, number> = { receiving_receptions: rec, receiving_yards: yds, receiving_touchdown: recTd.get(p.key) ?? 0 };
      if (p === rb) {
        const car = pois(rng, 16);
        Object.assign(stats, { rushing_attempts: car, rushing_yards: Math.round(car * rng.normal(5 + 0.8 * rb.talent - 0.3 * def, 1)),
          rushing_touchdown: tds - passTd, misc_fumble_lost: rng.chance(0.12) ? 1 : 0 });
      }
      out[i]!.push({ athlete: p.key, starter: true, position: null, stats });
    }
    const ints = pois(rng, 1 * Math.exp(-0.3 * qb.talent));
    out[i]!.push({ athlete: qb.key, starter: true, position: null, stats: {
      passing_attempts: att, passing_completions: comp, passing_yards: passYds, passing_touchdown: passTd, passing_interception: ints,
      rushing_attempts: pois(rng, 4), rushing_yards: Math.round(rng.normal(15 + 8 * qb.talent, 10)), misc_fumble_lost: rng.chance(0.08) ? 1 : 0 } });
    const k = me.find((p) => p.position === 'K');
    if (k) out[i]!.push({ athlete: k.key, starter: true, position: null, stats: { kicking_fg_made: fgs } });
  }
  for (let i = 0; i < 2; i++) {
    const defs = xs[i]!.filter(isDef);
    const tk = distribute(rng, pois(rng, 55), defs, (p) => (p.position === 'LB' ? 1.6 : 1) * Math.exp(0.35 * p.talent));
    const sk = distribute(rng, pois(rng, 2.2), defs, (p) => (p.position === 'DL' ? 3 : p.position === 'LB' ? 1 : 0.2) * Math.exp(0.6 * p.talent));
    const int = distribute(rng, pois(rng, 0.9), defs, (p) => (p.position === 'DB' ? 3 : 0.5) * Math.exp(0.6 * p.talent));
    const pd = distribute(rng, pois(rng, 4), defs, (p) => (p.position === 'DB' ? 3 : 0.4) * Math.exp(0.5 * p.talent));
    for (const p of defs) {
      const t = tk.get(p.key) ?? 0;
      out[i]!.push({ athlete: p.key, starter: true, position: null, stats: {
        defence_tackles: t, defence_solo_tackles: Math.round(t * 0.6), defence_sacks: sk.get(p.key) ?? 0,
        defence_tackles_for_loss: (sk.get(p.key) ?? 0) + (rng.chance(0.15) ? 1 : 0), defence_interceptions: int.get(p.key) ?? 0,
        defence_passes_defended: pd.get(p.key) ?? 0, defence_forced_fumbles: rng.chance(0.04 + 0.02 * p.talent) ? 1 : 0,
        defence_fumble_recoveries: rng.chance(0.03) ? 1 : 0 } });
    }
  }
  if (scores[0] === scores[1]) scores[rng.int(2) as 0 | 1] += 3;
  return { scores, lines: out };
}

const GAMES: Record<string, (rng: Rng, h: Team, a: Team) => { scores: [number, number]; lines: Array<Array<Omit<FakeLine, 'game' | 'uni' | 'opp'>>> }> = {
  hockey: hockeyGame, basketball: basketballGame, soccer: soccerGame, volleyball: volleyballGame, football: footballGame,
};

// ------------------------------------------------------------------ assembly

export interface FakeOptions {
  seed?: number;
  teams?: number;
  sportCodes?: string[];
  seasons?: [string, string];
}

export function generateFakeData(opts: FakeOptions = {}): FakeData {
  const rng = createRng(opts.seed ?? 20251);
  const nTeams = Math.min(opts.teams ?? 12, SCHOOLS.length);
  const seasons = opts.seasons ?? ['2025-26', '2026-27'];
  const universities = SCHOOLS.slice(0, nTeams).map((s, i) => ({
    slug: `dev-${s.toLowerCase().replace(/[^a-z]+/g, '-')}`, name: `${s} (dev)`, conference: CONFERENCES[i % 4]!,
  }));
  const athletes: FakeAthlete[] = [];
  const games: FakeGame[] = [];
  const lines: FakeLine[] = [];

  for (const code of opts.sportCodes ?? Object.keys(FAKE_SPORT_CODES)) {
    const sport = FAKE_SPORT_CODES[code]!;
    const teams: Team[] = universities.map((u) => ({ uni: u.slug, players: [] }));
    for (const team of teams) {
      let jersey = 1;
      for (const spec of ROSTERS[sport]!) {
        for (let i = 0; i < spec.count; i++) {
          const a: FakeAthlete = {
            key: `${code}:${team.uni}:${spec.position}:${i}`, first: rng.pick(FIRST), last: rng.pick(LAST), uni: team.uni, sport: code,
            position: spec.position, positions: POS_TOKENS[spec.position] ?? [spec.position], jersey: String(jersey++),
            classYear: String(1 + rng.int(5)), talent: rng.normal(), plays: true,
          };
          team.players.push(a);
          athletes.push(a);
        }
      }
      // one incoming freshman per team who hasn't played yet: rated NEW
      const fresh = rng.pick(team.players.filter((p) => !['K', 'OL', 'GK', 'G'].includes(p.position)));
      fresh.plays = false;
    }
    const [g0, g1] = SEASON_GAMES[sport]!;
    seasons.forEach((season, si) => {
      const year = Number(season.slice(0, 4));
      const perTeam = si === 0 ? g0 : g1;
      const startMonth = sport === 'football' || sport === 'soccer' ? 8 : 10;
      for (let round = 0; round < perTeam; round++) {
        const order = teams.slice();
        for (let j = order.length - 1; j > 0; j--) {
          const r = rng.int(j + 1);
          [order[j], order[r]] = [order[r]!, order[j]!];
        }
        const date = new Date(Date.UTC(year, startMonth, 1 + round * (si === 0 ? 6 : 4))).toISOString().slice(0, 10);
        for (let m = 0; m + 1 < order.length; m += 2) {
          const [h, a] = [order[m]!, order[m + 1]!];
          const key = `${code}:${season}:${round}:${m}`;
          const g = GAMES[sport]!(rng, h, a);
          games.push({ key, sport: code, season, date, home: h.uni, away: a.uni, homeScore: g.scores[0], awayScore: g.scores[1] });
          g.lines[0]!.forEach((l) => lines.push({ ...l, game: key, uni: h.uni, opp: a.uni }));
          g.lines[1]!.forEach((l) => lines.push({ ...l, game: key, uni: a.uni, opp: h.uni }));
        }
      }
    });
  }
  return { universities, athletes, games, lines };
}
