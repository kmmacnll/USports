'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  BB, DRAFT_CLOCK, DT, FB, INIT_SLOTS, ME_DRAFT, MY_BASE, OPP, OPP_BASE, RIVALS, ROUNDS, SLOTS, STARTERS, ME_TEAM, OPP_TEAM,
  elig, fb, gs, randomPlay, short, teamFor, type DayKey, type FbPos, type SportId,
} from './data';

export type Stage = 'welcome' | 'elig' | 'app';
export type Tab = 'home' | 'league' | 'players' | 'scores';
export type Seg = 'matchup' | 'standings' | 'roster';
export type Sheet = null | { type: 'player'; id: string } | { type: 'league' };
export type FeedItem = { key: number; who: string; text: string; pts: string; mine: boolean };
export type DraftView = 'players' | 'queue' | 'team';
export type Draft = { picks: string[]; clock: number; view: DraftView; pos: 'All' | 'G' | 'F' | 'C'; queue: string[] };
export type ExtraLeague = { name: string; badge: string; sub: string; rank: string; pts: string; toast: string };
export type Owner = 'mine' | 'opp' | 'fa';

export type State = {
  stage: Stage; isAthlete: boolean | null; athSports: SportId[]; accepted: boolean;
  tab: Tab; seg: Seg;
  live: Record<string, number>; flash: string | null; feed: FeedItem[];
  slots: (string | null)[]; sel: number | null;
  q: string; pos: 'All' | FbPos; availOnly: boolean;
  sheet: Sheet; mode: 'create' | 'join'; newName: string; newSport: SportId; newTeams: 8 | 10 | 12; priv: boolean; joinCode: string;
  toast: { text: string; key: number } | null;
  day: DayKey; scoreSport: SportId; extraLeagues: ExtraLeague[]; hoopsDrafted: boolean;
  draftOpen: boolean; draft: Draft;
};

/** Deep-linkable screens: `/mobile#standings` etc. */
export const SCREENS = ['onboarding', 'home', 'matchup', 'standings', 'roster', 'players', 'scores', 'draft'] as const;
export type Screen = (typeof SCREENS)[number];

const freshDraft = (): Draft => ({ picks: [], clock: DRAFT_CLOCK, view: 'players', pos: 'All', queue: [] });

const initial: State = {
  stage: 'app', isAthlete: null, athSports: [], accepted: false,
  tab: 'home', seg: 'matchup',
  live: Object.fromEntries(FB.map((a) => [a.id, a.today])), flash: null,
  feed: [
    { key: 3, who: 'F. Tremblay', text: 'Completion 22 yds', pts: '+0.9', mine: true },
    { key: 2, who: 'E. Kowalski', text: 'TD pass', pts: '+4.0', mine: false },
    { key: 1, who: 'J. Okafor', text: 'Rush 11 yds', pts: '+1.1', mine: true },
  ],
  slots: INIT_SLOTS.slice(), sel: null,
  q: '', pos: 'All', availOnly: false,
  sheet: null, mode: 'create', newName: '', newSport: 'usports_fb', newTeams: 10, priv: true, joinCode: '',
  toast: null, day: 'Today', scoreSport: 'usports_fb', extraLeagues: [], hoopsDrafted: false,
  draftOpen: false, draft: freshDraft(),
};

type Patch = Partial<State> | ((s: State) => Partial<State> | null);

function useStoreValue() {
  const [st, setSt] = useState<State>(initial);
  const set = useCallback((p: Patch) => setSt((s) => {
    const o = typeof p === 'function' ? p(s) : p;
    return o ? { ...s, ...o } : s;
  }), []);
  const stRef = useRef(st);
  useEffect(() => { stRef.current = st; });

  // ---- toast ----
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((text: string) => {
    set({ toast: { text, key: Date.now() } });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => set({ toast: null }), 2200);
  }, [set]);

  // ---- live scoring: a random play every 2.4 s for a starter whose game is live ----
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const iv = setInterval(() => {
      const s = stRef.current;
      const mine = s.slots.slice(0, STARTERS).filter((x): x is string => !!x);
      const pool = [...mine, ...OPP].filter((id) => { const g = gs(fb(id).uni); return g.live && (g.f ?? 0) < 0.9; });
      const id = pool[Math.floor(Math.random() * pool.length)];
      if (!id) return;
      const a = fb(id);
      const [text, pts] = randomPlay(a.pos);
      const isMine = mine.includes(id);
      set((x) => ({
        live: { ...x.live, [id]: x.live[id]! + pts }, flash: id,
        feed: [{ key: Date.now(), who: short(a), text, pts: `+${pts.toFixed(1)}`, mine: isMine }, ...x.feed].slice(0, 3),
      }));
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => set({ flash: null }), 1100);
    }, 2400);
    return () => { clearInterval(iv); clearTimeout(flashTimer.current); clearTimeout(toastTimer.current); };
  }, [set]);

  // ---- draft: other teams pick each second; your clock counts down, then auto-picks ----
  const pick = useCallback((id: string) => set((s) => {
    const d = s.draft;
    if (d.picks.includes(id)) return null;
    return { draft: { ...d, picks: [...d.picks, id], clock: DRAFT_CLOCK, queue: d.queue.filter((q) => q !== id) } };
  }), [set]);
  useEffect(() => {
    if (!st.draftOpen) return;
    const iv = setInterval(() => {
      const d = stRef.current.draft;
      const n = d.picks.length;
      if (n >= DT * ROUNDS) return;
      if (teamFor(n) === ME_DRAFT) {
        if (d.clock <= 1) {
          const q = d.queue.find((id) => !d.picks.includes(id));
          pick(q ?? BB.find((b) => !d.picks.includes(b.id))!.id);
        } else set((s) => ({ draft: { ...s.draft, clock: s.draft.clock - 1 } }));
      } else {
        const avail = BB.filter((b) => !d.picks.includes(b.id));
        const c = avail[Math.min(avail.length - 1, Math.floor(Math.random() * Math.min(3, avail.length)))]!;
        pick(c.id);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [st.draftOpen, pick, set]);

  // ---- navigation (kept in the URL hash so back/forward work) ----
  const apply = useCallback((k: Screen) => {
    const base = { stage: 'app' as Stage, sheet: null, draftOpen: false, sel: null };
    switch (k) {
      case 'onboarding': return set({ ...base, stage: 'welcome' });
      case 'home': case 'players': case 'scores': return set({ ...base, tab: k });
      case 'matchup': case 'standings': case 'roster': return set({ ...base, tab: 'league', seg: k });
      case 'draft': return set((s) => ({ ...base, draftOpen: true, draft: s.draftOpen ? s.draft : freshDraft() }));
    }
  }, [set]);
  const go = useCallback((k: Screen) => {
    apply(k);
    const url = k === 'home' ? location.pathname : `#${k}`;
    if (location.hash.slice(1) !== k) history.pushState(null, '', url);
  }, [apply]);
  useEffect(() => {
    const read = () => {
      const h = location.hash.slice(1);
      apply((SCREENS as readonly string[]).includes(h) ? (h as Screen) : 'home');
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [apply]);

  // ---- roster ----
  const owner = useCallback((id: string): Owner => (st.slots.includes(id) ? 'mine' : OPP.includes(id) ? 'opp' : 'fa'), [st.slots]);
  const addPlayer = useCallback((id: string) => {
    const i = st.slots.findIndex((p, j) => j >= STARTERS && !p);
    if (i < 0) return toast('Bench full. Drop a player first.');
    const slots = st.slots.slice(); slots[i] = id;
    set({ slots, sheet: null });
    toast(`${short(fb(id))} added to bench`);
  }, [st.slots, set, toast]);
  const dropPlayer = useCallback((id: string) => {
    set({ slots: st.slots.map((p) => (p === id ? null : p)), sheet: null, sel: null });
    toast(`${short(fb(id))} dropped`);
  }, [st.slots, set, toast]);
  const canMove = useCallback((i: number) => {
    const from = st.sel;
    if (from === null || from === i) return false;
    const a = fb(st.slots[from]!);
    const bId = st.slots[i];
    return elig(SLOTS[i]!, a.pos) && (!bId || elig(SLOTS[from]!, fb(bId).pos));
  }, [st.sel, st.slots]);
  const tapSlot = useCallback((i: number) => {
    const s = st.slots;
    if (st.sel === null) { if (s[i]) set({ sel: i }); return; }
    if (st.sel === i) return set({ sel: null });
    if (canMove(i)) {
      const n = s.slice(); [n[st.sel], n[i]] = [n[i]!, n[st.sel]!];
      set({ slots: n, sel: null });
      toast(`${short(fb(s[st.sel]!))} moved to ${SLOTS[i] === 'BN' ? 'bench' : SLOTS[i]}`);
    } else if (s[i]) set({ sel: i });
  }, [st.slots, st.sel, canMove, set, toast]);

  // ---- matchup math (shared by Home and League) ----
  const matchup = useMemo(() => {
    const proj = (id: string) => { const a = fb(id), g = gs(a.uni), v = st.live[id]!; return g.live ? v + a.fpg * (1 - (g.f ?? 0)) : g.up ? a.fpg : v; };
    const starters = st.slots.slice(0, STARTERS);
    const sum = (ids: (string | null)[], f: (id: string) => number) => ids.reduce((t, id) => t + (id ? f(id) : 0), 0);
    const my = sum(starters, (id) => st.live[id]!), op = sum(OPP, (id) => st.live[id]!);
    const myP = sum(starters, proj), opP = sum(OPP, proj);
    const win = 1 / (1 + Math.exp(-(myP - opP) / 14));
    const teams = [
      { n: ME_TEAM, o: 'You', base: MY_BASE, today: my, live: true, me: true },
      { n: OPP_TEAM, o: 'Priya S.', base: OPP_BASE, today: op, live: true, me: false },
      ...RIVALS.map((r) => ({ ...r, me: false })),
    ];
    const before = teams.slice().sort((a, b) => b.base - a.base).map((t) => t.n);
    const standings = teams.slice().sort((a, b) => b.base + b.today - (a.base + a.today)).map((t, i) => ({ ...t, rank: i + 1, move: before.indexOf(t.n) - i }));
    const myRank = standings.findIndex((t) => t.me) + 1;
    return { my, op, myP, opP, win, standings, myRank };
  }, [st.live, st.slots]);

  const openDraft = useCallback(() => go('draft'), [go]);
  /** Leave the draft room without adding a history entry for the screen underneath. */
  const closeDraft = useCallback((patch: Partial<State> = {}) => {
    set({ draftOpen: false, ...patch });
    const s = stRef.current;
    const k = s.tab === 'league' ? s.seg : s.tab;
    history.replaceState(null, '', k === 'home' ? location.pathname : `#${k}`);
  }, [set]);

  return { st, set, toast, go, pick, owner, addPlayer, dropPlayer, canMove, tapSlot, matchup, openDraft, closeDraft };
}

export type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const v = useStoreValue();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
