// Demo data for the VarsityHQ mobile app (from the "VarsityHQ App" Claude Design handoff).
// Every athlete, team and owner here is fictional. Nothing is fetched from the API yet.

export const C = {
  bg: '#0A0F1A',
  surface: '#111A2A',
  surface2: '#18233A',
  raised: '#1D2A44',
  segOn: '#263552',
  primary: '#D93A40',
  primaryHover: '#F06A6E',
  ink: '#FFFFFF',
  text: '#F2F4F8',
  text2: '#C3CBDA',
  muted: '#93A0B8',
  dim: '#64708A',
  faint: '#4A5672',
  blue: '#8EB1F5',
  green: '#4CC38A',
  loss: '#F06A5E',
  dark: '#0B111D',
  line: '1px solid rgba(255,255,255,.05)',
} as const;

export const DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";

// ---------- Universities ----------
export const U: Record<string, [name: string, color: string]> = {
  LAV: ['Laval', '#C8102E'], MTL: ['Montréal', '#2F6FC0'], UBC: ['UBC', '#2350A8'], WES: ['Western', '#6E3FC0'],
  QUE: ["Queen's", '#B3263A'], SAS: ['Saskatchewan', '#2A7F4F'], CGY: ['Calgary', '#D0402B'], ALB: ['Alberta', '#2C8048'],
  OTT: ['Ottawa', '#8E2434'], CAR: ['Carleton', '#C9302C'], MAC: ['McMaster', '#7D1F3B'], WLU: ['Laurier', '#5E3A99'],
  GUE: ['Guelph', '#BC1F2E'], MAN: ['Manitoba', '#A87A26'], STFX: ['StFX', '#3567B0'], BIS: ["Bishop's", '#6A47B5'],
  SHE: ['Sherbrooke', '#2D7A45'], REG: ['Regina', '#2D7A45'], ACA: ['Acadia', '#B8202E'], BRK: ['Brock', '#B8202E'],
  VIC: ['Victoria', '#2A57A8'], TMU: ['TMU', '#1E5AA8'], WIN: ['Windsor', '#2A57A8'], UQM: ['UQAM', '#2F7FC0'],
};
export const uniName = (a: string) => U[a]?.[0] ?? a;
export const uniColor = (a: string) => U[a]?.[1] ?? '#4A5672';

// ---------- Today's game state per university ----------
export type GameState = { s: string; live?: boolean; up?: boolean; fin?: boolean; f?: number };
const GS: Record<string, GameState> = {
  LAV: { s: 'Q3 8:12', live: true, f: 0.6 }, MTL: { s: 'Q3 8:12', live: true, f: 0.6 },
  WES: { s: 'Q2 3:40', live: true, f: 0.4 }, QUE: { s: 'Q2 3:40', live: true, f: 0.4 },
  MAC: { s: 'Q4 1:55', live: true, f: 0.95 }, GUE: { s: 'Q4 1:55', live: true, f: 0.95 },
  UBC: { s: '7:30 PM', up: true }, SAS: { s: '7:30 PM', up: true },
  STFX: { s: 'Sat 1:00 PM', up: true }, ACA: { s: 'Sat 1:00 PM', up: true },
};
export const gs = (a: string): GameState => GS[a] ?? { s: 'Final', fin: true };

// ---------- Football pool (OUA Diehards league) ----------
export type FbPos = 'QB' | 'RB' | 'WR' | 'K' | 'LB' | 'DB';
export type FbPlayer = { id: string; first: string; last: string; uni: string; pos: FbPos; fpg: number; gp: number; jersey: string; yr: string; today: number };

export const HT: Record<FbPos, string> = { QB: "6'2\"", RB: "5'10\"", WR: "6'0\"", K: "5'11\"", LB: "6'1\"", DB: "5'11\"" };

const FB_ROWS: [string, string, string, string, FbPos, number, number, string, string, number][] = [
  ['f1', 'Félix', 'Tremblay', 'LAV', 'QB', 24.6, 9, '12', '4th', 14.2], ['f2', 'Jordan', 'Okafor', 'WES', 'RB', 18.3, 9, '22', '3rd', 9.4],
  ['f3', 'Mathis', 'Côté', 'MTL', 'RB', 14.9, 8, '28', '2nd', 6.1], ['f4', 'Isaiah', 'Grant', 'UBC', 'WR', 16.2, 9, '81', '4th', 0],
  ['f5', 'Liam', 'Archambault', 'LAV', 'WR', 13.8, 9, '9', '3rd', 7.3], ['f6', 'Daniel', 'Mensah', 'QUE', 'WR', 12.1, 9, '17', '2nd', 4.0],
  ['f7', 'Owen', 'Pelletier', 'SAS', 'RB', 11.4, 8, '33', '3rd', 0], ['f8', 'Marc-Antoine', 'Roy', 'SHE', 'K', 9.6, 9, '3', '5th', 10.0],
  ['f9', 'Tyler', 'Banks', 'CGY', 'LB', 10.8, 9, '44', '4th', 12.0], ['f10', 'Xavier', 'Lindo', 'MAC', 'DB', 8.7, 9, '2', '3rd', 5.0],
  ['f11', 'Ethan', 'Brooks', 'GUE', 'QB', 15.2, 9, '7', '2nd', 11.6], ['f12', 'Noah', 'Singh', 'ALB', 'WR', 9.9, 9, '84', '2nd', 8.5],
  ['f13', 'Samuel', 'Gagnon', 'MTL', 'LB', 8.1, 9, '52', '3rd', 3.0], ['f14', 'Cole', 'Whitaker', 'REG', 'RB', 7.6, 7, '26', '1st', 6.2],
  ['f21', 'Evan', 'Kowalski', 'WES', 'QB', 22.9, 9, '10', '5th', 16.8], ['f22', 'Malik', 'Jean-Baptiste', 'MTL', 'RB', 16.7, 9, '5', '4th', 11.2],
  ['f23', 'Ryan', 'Dubé', 'OTT', 'RB', 13.1, 9, '31', '3rd', 15.6], ['f24', 'Aiden', 'Clarke', 'QUE', 'WR', 15.4, 9, '88', '4th', 6.5],
  ['f25', 'Jonah', 'Fraser', 'STFX', 'WR', 12.8, 8, '19', '3rd', 0], ['f26', 'Théo', 'Bergeron', 'LAV', 'WR', 11.9, 9, '14', '2nd', 5.2],
  ['f27', 'Brandon', 'Achebe', 'CAR', 'WR', 10.2, 9, '80', '3rd', 9.1], ['f28', 'Luca', 'Moretti', 'WLU', 'K', 8.8, 9, '39', '4th', 7.0],
  ['f29', 'Dylan', 'Harper', 'MAN', 'LB', 9.7, 9, '45', '3rd', 8.0], ['f30', 'Kofi', 'Asante', 'BIS', 'DB', 7.9, 9, '21', '2nd', 4.0],
  ['f31', 'Nathan', 'Lefebvre', 'SHE', 'QB', 17.8, 9, '11', '3rd', 19.4], ['f32', 'Jaden', 'Ward', 'WLU', 'RB', 12.6, 9, '23', '2nd', 14.0],
  ['f33', 'Hugo', 'Morin', 'LAV', 'WR', 11.1, 9, '15', '1st', 3.4], ['f34', 'Caleb', 'Nguyen', 'UBC', 'RB', 10.4, 8, '27', '2nd', 0],
  ['f35', 'Simon', 'Paquette', 'MTL', 'K', 8.9, 9, '6', '4th', 4.0], ['f36', 'Marcus', 'Reid', 'WES', 'DB', 8.4, 9, '24', '3rd', 2.0],
  ['f37', 'Elijah', 'Thompson', 'CGY', 'WR', 9.3, 9, '83', '2nd', 7.8], ['f38', 'Adam', 'Bouchard', 'OTT', 'LB', 8.6, 9, '48', '4th', 9.0],
  ['f39', 'Victor', 'Osei', 'GUE', 'DB', 7.2, 9, '29', '1st', 3.0], ['f40', 'Riley', 'McKenzie', 'SAS', 'WR', 8.0, 9, '86', '3rd', 0],
];
export const FB: FbPlayer[] = FB_ROWS.map((t) => ({ id: t[0], first: t[1], last: t[2], uni: t[3], pos: t[4], fpg: t[5], gp: t[6], jersey: t[7], yr: t[8], today: t[9] }));
export const FBI: Record<string, FbPlayer> = Object.fromEntries(FB.map((a) => [a.id, a]));
export const fb = (id: string) => FBI[id]!;

/** Gee-Gee Whiz (Priya S.), this week's opponent: one starter per slot, in SLOTS order. */
export const OPP = ['f21', 'f22', 'f23', 'f24', 'f25', 'f26', 'f27', 'f28', 'f29', 'f30'];
export type Slot = 'QB' | 'RB' | 'WR' | 'FLEX' | 'K' | 'LB' | 'DB' | 'BN';
/** 10 starters, then 5 bench slots. */
export const SLOTS: Slot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'FLEX', 'K', 'LB', 'DB', 'BN', 'BN', 'BN', 'BN', 'BN'];
export const STARTERS = 10;
export const INIT_SLOTS: (string | null)[] = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'f13', 'f14', null];
/** Mirrors the API rule: bench takes anyone, FLEX takes RB/WR, other slots need the exact position. */
export const elig = (slot: Slot, pos: FbPos) => slot === 'BN' || slot === pos || (slot === 'FLEX' && (pos === 'RB' || pos === 'WR'));
export const slotLabel = (s: Slot) => (s === 'FLEX' ? 'FLX' : s);

export const ME_TEAM = 'North Shore Gridiron';
export const OPP_TEAM = 'Gee-Gee Whiz';
export const MY_BASE = 1284.6;
export const OPP_BASE = 1301.2;
export const RIVALS = [
  { n: 'Rouge et Or Not', o: 'Luc B.', base: 1266.0, today: 52.4, live: true },
  { n: 'Mustang Sally', o: 'Emma W.', base: 1240.8, today: 38.1, live: true },
  { n: 'Thunder Bird Law', o: 'Arjun P.', base: 1229.5, today: 12.0, live: false },
  { n: 'Huskie Business', o: 'Jess T.', base: 1198.3, today: 44.7, live: true },
  { n: 'Hawk Talk', o: 'Marco D.', base: 1177.9, today: 29.3, live: false },
  { n: 'Dino Might', o: 'Sam K.', base: 1150.2, today: 61.0, live: true },
  { n: 'Gael Force', o: 'Nora L.', base: 1121.4, today: 33.6, live: true },
  { n: 'Maroon 5th Down', o: 'Ben H.', base: 1089.7, today: 20.2, live: false },
];

// ---------- Basketball pool (Snow Bowl Hoops draft) ----------
export type BbPlayer = { id: string; first: string; last: string; uni: string; pos: 'G' | 'F' | 'C'; fpg: number; ppg: number; rpg: number; apg: number };
const BB_ROWS: [string, string, string, string, BbPlayer['pos'], number, number, number, number][] = [
  ['b1', 'Isaac', 'Bonsu', 'CAR', 'F', 38.4, 21.2, 9.1, 2.4], ['b2', 'Marcus', 'Tavares', 'BRK', 'G', 35.9, 23.5, 4.2, 5.8],
  ['b3', 'Kaden', 'Fleury', 'VIC', 'G', 34.1, 19.8, 5.0, 6.9], ['b4', 'Elijah', 'Mbeki', 'UQM', 'C', 33.6, 16.4, 11.8, 1.2],
  ['b5', 'Tristan', 'Hall', 'QUE', 'G', 32.2, 20.1, 3.9, 5.1], ['b6', 'Owen', 'Lachance', 'OTT', 'F', 31.5, 17.9, 8.0, 2.9],
  ['b7', 'Andre', 'Phillips', 'TMU', 'G', 30.8, 18.6, 4.4, 6.2], ['b8', 'Jamal', 'Wright', 'ALB', 'F', 29.9, 16.7, 8.6, 2.1],
  ['b9', 'Mathieu', 'Gendron', 'LAV', 'G', 29.1, 17.2, 3.6, 5.4], ['b10', 'Darius', 'King', 'CGY', 'C', 28.4, 13.9, 10.4, 1.6],
  ['b11', 'Ben', 'Okonkwo', 'MAC', 'F', 27.6, 15.5, 7.7, 2.2], ['b12', 'Liam', 'Fortin', 'SHE', 'G', 26.9, 16.1, 3.1, 4.8],
  ['b13', 'Nolan', 'Price', 'WIN', 'F', 26.2, 14.8, 7.2, 2.5], ['b14', 'Xavier', 'Dumont', 'MTL', 'G', 25.7, 14.2, 3.8, 5.6],
  ['b15', 'Chris', 'Adeyemi', 'UBC', 'C', 25.1, 12.6, 9.9, 1.1], ['b16', 'Sean', 'Murphy', 'STFX', 'G', 24.4, 15.0, 3.4, 4.0],
  ['b17', 'Ryan', 'Baptiste', 'CAR', 'G', 23.8, 13.1, 3.0, 5.9], ['b18', 'Kwame', 'Asare', 'GUE', 'F', 23.2, 12.9, 6.8, 1.9],
  ['b19', 'Josh', 'Leblanc', 'ACA', 'F', 22.7, 13.4, 6.1, 1.7], ['b20', 'Matteo', 'Rossi', 'WLU', 'G', 22.1, 13.8, 2.9, 4.1],
  ['b21', 'Ethan', 'Clarke', 'MAN', 'C', 21.6, 10.8, 8.9, 0.9], ['b22', 'Aaron', 'Kim', 'TMU', 'G', 21.0, 12.4, 2.7, 4.5],
  ['b23', 'David', 'Ouellet', 'LAV', 'F', 20.4, 11.6, 6.3, 1.8], ['b24', 'Jordan', 'Price', 'REG', 'G', 19.9, 12.0, 3.2, 3.7],
  ['b25', 'Tyrese', 'Grant', 'BRK', 'F', 19.3, 10.9, 6.6, 1.4], ['b26', 'Samuel', 'Diallo', 'UQM', 'G', 18.8, 11.2, 2.8, 3.9],
  ['b27', 'Noah', 'Fischer', 'SAS', 'C', 18.2, 9.4, 8.1, 0.8], ['b28', 'Lucas', 'Martin', 'OTT', 'G', 17.7, 10.6, 2.5, 3.6],
  ['b29', 'Gabriel', 'Henry', 'VIC', 'F', 17.1, 9.8, 5.9, 1.5], ['b30', 'Ian', 'Morrison', 'CGY', 'G', 16.6, 9.9, 2.6, 3.3],
];
export const BB: BbPlayer[] = BB_ROWS.map((t) => ({ id: t[0], first: t[1], last: t[2], uni: t[3], pos: t[4], fpg: t[5], ppg: t[6], rpg: t[7], apg: t[8] }));
export const BBI: Record<string, BbPlayer> = Object.fromEntries(BB.map((a) => [a.id, a]));
export const bb = (id: string) => BBI[id]!;

export const DTEAMS = ['Paint Kings', 'Bucket Brigade', 'Glass Cleaners', 'Fast Break Fellas', 'Corner Three Co.', 'Ravens Nest', 'Dribble Drive', 'Full Court Press', 'Backdoor Cuts', 'Nothing But Net'];
export const DT = 10;
export const ME_DRAFT = 3;
export const ROUNDS = 3;
export const DRAFT_CLOCK = 30;
/** Snake order: which team (0-based) makes overall pick `i`. */
export const teamFor = (i: number) => { const r = Math.floor(i / DT), p = i % DT; return r % 2 === 0 ? p : DT - 1 - p; };
export const pickLabel = (i: number) => `${Math.floor(i / DT) + 1}.${String((i % DT) + 1).padStart(2, '0')}`;

// ---------- Sports ----------
export type SportId = 'usports_fb' | 'usports_msoc' | 'usports_wsoc' | 'usports_mbk' | 'usports_wbk' | 'usports_mhk' | 'usports_whk' | 'usports_mvb' | 'usports_wvb';
export const SPORTS: [id: SportId, name: string, code: string][] = [
  ['usports_fb', 'Football', 'FB'], ['usports_msoc', "Men's Soccer", 'MSOC'], ['usports_wsoc', "Women's Soccer", 'WSOC'],
  ['usports_mbk', "Men's Basketball", 'MBB'], ['usports_wbk', "Women's Basketball", 'WBB'], ['usports_mhk', "Men's Hockey", 'MHK'],
  ['usports_whk', "Women's Hockey", 'WHK'], ['usports_mvb', "Men's Volleyball", 'MVB'], ['usports_wvb', "Women's Volleyball", 'WVB'],
];
export const sportName = (id: SportId) => SPORTS.find((s) => s[0] === id)![1];

// ---------- Scores ----------
export type Game = { home: string; hs: number | null; away: string; as: number | null; state: 'live' | 'up' | 'fin'; clock?: string };
const g = (home: string, hs: number | null, away: string, as: number | null, state: Game['state'], clock?: string): Game => ({ home, hs, away, as, state, clock });
export type DayKey = 'Thu 5' | 'Today' | 'Sat 7';
export const DAYS: [dow: string, label: string, key: DayKey][] = [['Thu', 'Nov 5', 'Thu 5'], ['Fri', 'Today', 'Today'], ['Sat', 'Nov 7', 'Sat 7']];
export const GAMES: Record<DayKey, Game[]> = {
  Today: [
    g('MTL', 17, 'LAV', 24, 'live', 'Q3 8:12'), g('QUE', 7, 'WES', 14, 'live', 'Q2 3:40'), g('GUE', 20, 'MAC', 23, 'live', 'Q4 1:55'),
    g('SAS', null, 'UBC', null, 'up', '7:30 PM'), g('BIS', 13, 'SHE', 31, 'fin'), g('ALB', 18, 'CGY', 27, 'fin'),
    g('CAR', 28, 'OTT', 21, 'fin'), g('REG', 10, 'MAN', 24, 'fin'), g('WIN', 16, 'WLU', 30, 'fin'),
  ],
  'Sat 7': [g('ACA', null, 'STFX', null, 'up', '1:00 PM')],
  'Thu 5': [],
};

// ---------- Helpers ----------
/** Deterministic PRNG seeded from a string, so a player's game log is stable across renders. */
export const rng = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
export const short = (a: { first: string; last: string }) => `${a.first[0]}. ${a.last}`;
export const full = (a: { first: string; last: string }) => `${a.first} ${a.last}`;

/** A random live-scoring play for a football player, as [description, fantasy points]. */
export function randomPlay(pos: FbPos): [string, number] {
  const r = Math.random();
  let y: number;
  switch (pos) {
    case 'QB': return r < 0.18 ? ['TD pass', 4] : r < 0.35 ? ((y = ri(4, 16)), [`Scramble ${y} yds`, y * 0.1]) : ((y = ri(9, 38)), [`Completion ${y} yds`, y * 0.04]);
    case 'RB': return r < 0.15 ? ['Rushing TD', 6] : r < 0.4 ? ((y = ri(6, 22)), [`Catch ${y} yds`, 0.5 + y * 0.1]) : ((y = ri(3, 14)), [`Rush ${y} yds`, y * 0.1]);
    case 'WR': return r < 0.15 ? ['Receiving TD', 6] : ((y = ri(8, 31)), [`Catch ${y} yds`, 0.5 + y * 0.1]);
    case 'K': return r < 0.5 ? [`FG ${ri(25, 48)} yds`, 3] : ['PAT good', 1];
    default: return r < 0.15 ? ['Sack', 2] : r < 0.22 ? ['Interception', 3] : ['Tackle', 1];
  }
}
