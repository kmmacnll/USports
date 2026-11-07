'use client';

import { useEffect, useRef } from 'react';

import { C, HT, OPP_TEAM, SPORTS, fb, full, gs, rng, uniName, type FbPos } from './data';
import { useStore } from './store';
import { PrimaryButton, Segmented, UniMark, num } from './ui';

const INVITE_CODE = 'VHQ7K2';

export function Sheets() {
  const { st, set } = useStore();
  const panel = useRef<HTMLDivElement>(null);
  const open = !!st.sheet;

  // Escape closes; focus moves into the sheet and back to the trigger afterwards.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ sheet: null }); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, set]);

  if (!st.sheet) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
      <div onClick={() => set({ sheet: null })} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', animation: 'vhq-fade .25s ease' }} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={st.sheet.type === 'player' ? 'Player card' : 'Create or join a league'} className="vhq-noscroll"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', overflow: 'auto', borderRadius: '28px 28px 0 0', background: C.surface, padding: '8px 0 40px', animation: 'vhq-sheet .32s cubic-bezier(.2,.8,.2,1)', outline: 'none' }}>
        <button type="button" aria-label="Close" onClick={() => set({ sheet: null })} style={{ display: 'block', margin: '0 auto 12px', padding: '4px 20px' }}>
          <span style={{ display: 'block', width: 38, height: 5, borderRadius: 3, background: '#2C3A57' }} />
        </button>
        {st.sheet.type === 'player' ? <PlayerSheet id={st.sheet.id} /> : <LeagueSheet />}
      </div>
    </div>
  );
}

type Col = [label: string, gen: (R: (x: number, y: number) => number) => number];
const LOG_COLS: Partial<Record<FbPos, Col[]>> = {
  QB: [['PASS', (R) => R(170, 340)], ['TD', (R) => R(0, 4)], ['RUSH', (R) => R(0, 60)]],
  RB: [['RUSH', (R) => R(40, 160)], ['TD', (R) => R(0, 2)], ['REC', (R) => R(0, 5)]],
  WR: [['REC', (R) => R(2, 9)], ['YDS', (R) => R(30, 140)], ['TD', (R) => R(0, 2)]],
  K: [['FGM', (R) => R(0, 4)], ['XP', (R) => R(1, 5)], ['LNG', (R) => R(28, 52)]],
  LB: [['TKL', (R) => R(3, 11)], ['SACK', (R) => R(0, 2)], ['INT', (R) => R(0, 1)]],
};
const SEASON: Record<FbPos, [string, number][]> = {
  QB: [['PASS YPG', 11.5], ['RUSH YPG', 1.2]], RB: [['RUSH YPG', 5.6], ['REC/G', 0.15]], WR: [['REC/G', 0.38], ['REC YPG', 5.2]],
  K: [['FGM/G', 0.2], ['XP/G', 0.25]], LB: [['TKL/G', 0.7], ['SACKS', 0.3]], DB: [['TKL/G', 0.55], ['INT', 0.25]],
};
const LOG_DATES = ['Oct 31', 'Oct 24', 'Oct 17', 'Oct 10', 'Oct 3', 'Sep 26'];
const LOG_OPPS = ['LAV', 'MTL', 'WES', 'QUE', 'UBC', 'SAS', 'CGY', 'OTT', 'MAC', 'GUE', 'CAR', 'WLU'];

function PlayerSheet({ id }: { id: string }) {
  const { st, set, owner, addPlayer, dropPlayer } = useStore();
  const a = fb(id), g = gs(a.uni), o = owner(id), r = rng(a.id);
  const R = (x: number, y: number) => Math.round(x + r() * (y - x));
  const cols = LOG_COLS[a.pos] ?? LOG_COLS.LB!;
  const opps = LOG_OPPS.filter((x) => x !== a.uni);
  const log = LOG_DATES.map((date) => ({
    date, opp: `${r() > 0.5 ? 'vs' : '@'} ${opps[Math.floor(r() * opps.length)]}`,
    v: cols.map((c) => c[1](R)), fp: (a.fpg * (0.55 + r() * 0.9)).toFixed(1),
  }));
  const stats = [
    { l: 'GP', v: String(a.gp), color: C.text }, { l: 'FP/G', v: a.fpg.toFixed(1), color: C.blue },
    ...SEASON[a.pos].map(([l, k]) => ({ l, v: (a.fpg * k).toFixed(1), color: C.text })),
  ];
  const grid = '1fr 40px 40px 40px 46px';
  const act = o === 'fa'
    ? { label: 'Add to bench', bg: C.primary, fg: C.ink, run: () => addPlayer(id) }
    : o === 'mine'
      ? { label: 'Drop player', bg: 'rgba(240,106,94,.14)', fg: C.loss, run: () => dropPlayer(id) }
      : { label: `On ${OPP_TEAM}`, bg: C.surface2, fg: C.dim, run: () => set({ sheet: null }) };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <UniMark uni={a.uni} size={58} radius={16} font={17} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.01em' }}>{full(a)}</h2>
          <span style={{ fontSize: 12.5, color: C.muted }}>{uniName(a.uni)} · {a.pos} · #{a.jersey} · {HT[a.pos]} · {a.yr} year</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, background: C.surface2, fontSize: 12.5, color: C.text2 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: g.live ? C.green : g.up ? C.dim : C.muted }} />
        <span style={{ flex: 1 }}>Today · {g.s}</span>
        <span style={num(17, C.blue)}>{g.up ? '—' : st.live[id]!.toFixed(1)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
        {stats.map((s) => (
          <div key={s.l} style={{ padding: '10px 4px', borderRadius: 12, background: C.surface2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={num(20, s.color, 600, 1)}>{s.v}</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.03em', color: C.dim, whiteSpace: 'nowrap' }}>{s.l}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 className="vhq-kicker" style={{ fontSize: 11 }}>Game log · 2026-27</h3>
        <div role="table" aria-label="Game log">
          <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, padding: '6px 0', fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: C.dim, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <span role="columnheader">GAME</span>
            {cols.map((c) => <span key={c[0]} role="columnheader" style={{ textAlign: 'right' }}>{c[0]}</span>)}
            <span role="columnheader" style={{ textAlign: 'right', color: C.blue }}>FP</span>
          </div>
          {log.map((row) => (
            <div key={row.date} role="row" style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', minHeight: 36, fontSize: 13, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <span role="cell"><span style={{ color: C.dim }}>{row.date}</span> {row.opp}</span>
              {row.v.map((v, i) => <span key={i} role="cell" style={{ textAlign: 'right' }}>{v}</span>)}
              <span role="cell" style={{ textAlign: 'right', fontWeight: 800, color: C.blue }}>{row.fp}</span>
            </div>
          ))}
        </div>
      </div>
      <PrimaryButton onClick={act.run} bg={act.bg} fg={act.fg} height={52} font={15}>{act.label}</PrimaryButton>
    </div>
  );
}

function LeagueSheet() {
  const { st, set, toast } = useStore();
  const blocked = (id: string) => !!st.isAthlete && (st.athSports as string[]).includes(id);
  const canCreate = st.newName.trim().length > 1 && !blocked(st.newSport);
  const canJoin = st.joinCode.length === 6;
  const label = { fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted } as const;

  const create = () => {
    if (!canCreate) return;
    const sp = SPORTS.find((s) => s[0] === st.newSport)!;
    set((s) => ({
      sheet: null, newName: '',
      extraLeagues: [...s.extraLeagues, { name: st.newName.trim(), badge: sp[2], sub: `1/${st.newTeams} teams · ${sp[1]}${st.priv ? ' · Private' : ''}`, rank: 'Pre-draft', pts: `Invite: ${INVITE_CODE}`, toast: `Share code ${INVITE_CODE} to invite` }],
    }));
    toast(`League created · code ${INVITE_CODE}`);
  };
  const join = () => {
    if (!canJoin) return;
    set((s) => ({
      sheet: null, joinCode: '',
      extraLeagues: [...s.extraLeagues, { name: 'Campus Classic', badge: 'WSOC', sub: "Joined · Women's Soccer · 7/10 teams", rank: 'Pre-draft', pts: 'Draft Sun 7 PM', toast: 'Draft opens Sunday' }],
    }));
    toast('Joined Campus Classic');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '0 20px' }}>
      <Segmented label="Create or join" value={st.mode} onChange={(k) => set({ mode: k })} height={38} font={14} track={C.bg}
        items={[['create', 'Create'], ['join', 'Join']]} />
      {st.mode === 'create' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>League name</span>
            <input value={st.newName} onChange={(e) => set({ newName: e.target.value })} placeholder="e.g. Residence Rivals" className="vhq-input"
              style={{ height: 48, padding: '0 14px', borderRadius: 12, background: C.bg, fontSize: 15 }} />
          </label>
          <div role="radiogroup" aria-label="Sport" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Sport</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SPORTS.map(([id, name]) => {
                const b = blocked(id), on = st.newSport === id;
                return (
                  <button key={id} type="button" role="radio" aria-checked={on} aria-disabled={b}
                    onClick={() => (b ? toast(`You compete in ${name}, so it’s locked`) : set({ newSport: id }))}
                    style={{ height: 36, padding: '0 12px', borderRadius: 18, fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
                      background: b ? C.dark : on ? C.primary : C.surface2, color: b ? C.faint : on ? C.ink : C.text2 }}>
                    {b && <span className="vhq-icon" aria-label="Locked" style={{ fontSize: 15 }}>lock</span>}{name}
                  </button>
                );
              })}
            </div>
            {st.isAthlete && st.athSports.length > 0 && <span style={{ fontSize: 11.5, color: C.dim }}>Locked sports are ones you compete in.</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span id="vhq-teams" style={{ fontSize: 14, fontWeight: 700 }}>Teams</span>
            <div role="radiogroup" aria-labelledby="vhq-teams" style={{ display: 'flex', gap: 6 }}>
              {([8, 10, 12] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={st.newTeams === t} onClick={() => set({ newTeams: t })}
                  style={{ width: 48, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', ...num(17, st.newTeams === t ? C.dark : C.text2), background: st.newTeams === t ? C.text : C.surface2 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button type="button" role="switch" aria-checked={st.priv} onClick={() => set((s) => ({ priv: !s.priv }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, textAlign: 'left' }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Private league</span>
              <span style={{ fontSize: 12, color: C.dim }}>Join by invite code only</span>
            </span>
            <span style={{ width: 51, height: 31, borderRadius: 16, background: st.priv ? C.primary : '#2C3A57', padding: 2, transition: 'background .2s', flex: 'none' }}>
              <span style={{ display: 'block', width: 27, height: 27, borderRadius: 14, background: '#fff', transform: st.priv ? 'translateX(20px)' : 'none', transition: 'transform .2s' }} />
            </span>
          </button>
          <PrimaryButton enabled={canCreate} onClick={create} height={52} font={15}>Create league</PrimaryButton>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Invite code</span>
            <input value={st.joinCode} onChange={(e) => set({ joinCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) })}
              placeholder="6 characters" maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck={false} className="vhq-input"
              style={{ height: 60, padding: '0 16px', borderRadius: 14, background: C.bg, ...num(28), letterSpacing: '.3em', textTransform: 'uppercase' }} />
          </label>
          <PrimaryButton enabled={canJoin} onClick={join} height={52} font={15}>Join league</PrimaryButton>
        </div>
      )}
    </div>
  );
}
