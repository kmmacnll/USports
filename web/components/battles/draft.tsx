'use client';

import { useEffect, useRef, useState } from 'react';

import { avgOvr, bestPick, DRAFT_PICKS, PICK_SECONDS, player, PLAYERS, slotOpen, type Opponent, type Pos, type Side } from './data';
import { useMe } from './me';
import { DISPLAY, EMPTY_SLOT_CLIP, PlayerCard } from './ui';

type Filter = 'All' | Pos;
const FILTERS: [Filter, string][] = [['All', 'All'], ['F', 'Forwards'], ['D', 'Defence'], ['G', 'Goalies']];

function Slots({ picks, side }: { picks: string[]; side: Side }) {
  const by: Record<Pos, string[]> = { F: [], D: [], G: [] };
  picks.forEach((id) => by[player(id).pos].push(id));
  const slot = (pos: Pos, i: number) => ({ pos, id: by[pos][i] });
  const F = [slot('F', 0), slot('F', 1), slot('F', 2)];
  const D = [slot('D', 0), slot('G', 0), slot('D', 1)];
  const rows = side === 'A' ? [F, D] : [D, F];
  const anim = side === 'A' ? 'vflyA .6s cubic-bezier(.2,.9,.25,1)' : 'vflyB .6s cubic-bezier(.2,.9,.25,1)';
  return (
    <>
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex', gap: 10 }}>
          {row.map((s, i) => (
            <div key={`${s.pos}${i}`} style={{ width: 52, height: 70, position: 'relative' }}>
              {s.id ? (
                <div key={s.id} style={{ animation: anim }}><PlayerCard p={player(s.id)} size="xs" /></div>
              ) : (
                <div aria-label={`Empty ${s.pos} slot`} style={{ width: 52, height: 70, clipPath: EMPTY_SLOT_CLIP, background: 'linear-gradient(160deg,rgba(142,177,245,.16),rgba(142,177,245,.05))', display: 'grid', placeItems: 'center', font: `800 14px ${DISPLAY}`, letterSpacing: '.12em', color: '#8390A8' }}>{s.pos}</div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export function DraftScreen({ opp, onStart }: { opp: Opponent; onStart: (a: string[], b: string[]) => void }) {
  const [dA, setA] = useState<string[]>([]);
  const [dB, setB] = useState<string[]>([]);
  const [turn, setTurn] = useState<Side>('A');
  const [clock, setClock] = useState(PICK_SECONDS);
  const [filt, setFilt] = useState<Filter>('All');

  const taken = [...dA, ...dB];
  const done = taken.length >= DRAFT_PICKS;
  const myTurn = turn === 'A' && !done;
  const state = useRef({ dA, dB, turn, done });
  state.current = { dA, dB, turn, done };

  const pick = (side: Side, id: string) => {
    if (side === 'A') { setA((x) => [...x, id]); setTurn('B'); }
    else { setB((x) => [...x, id]); setTurn('A'); }
    setClock(PICK_SECONDS);
  };

  // Your pick clock: auto-picks the best available at 0.
  useEffect(() => {
    if (!myTurn) return;
    const iv = setInterval(() => setClock((c) => c - 1), 1000);
    return () => clearInterval(iv);
  }, [myTurn]);
  useEffect(() => {
    if (myTurn && clock <= 0) {
      const b = bestPick(dA, taken, false);
      if (b) pick('A', b);
    }
  });

  // Opponent picks 1.5s after your pick.
  useEffect(() => {
    if (turn !== 'B' || done) return;
    const t = setTimeout(() => {
      const s = state.current;
      const b = bestPick(s.dB, [...s.dA, ...s.dB], true);
      if (b) pick('B', b);
    }, 1500);
    return () => clearTimeout(t);
  }, [turn, done]);

  const pool = PLAYERS.filter((p) => !taken.includes(p.id) && (filt === 'All' || p.pos === filt)).sort((a, b) => b.ovr - a.ovr);
  const aA = avgOvr(dA), aB = avgOvr(dB);
  const ringColor = myTurn ? (clock <= 5 ? '#FF8A3D' : '#E5484D') : '#8EB1F5';
  const ringOffset = done ? 0 : myTurn ? 113.1 * (1 - clock / PICK_SECONDS) : 0;
  const oppName = opp.ai ? opp.user : `@${opp.user}`;
  const me = useMe();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '8px 14px 0', display: 'flex', alignItems: 'center', gap: 10, height: 48 }}>
        <span style={{ width: 30, height: 30, borderRadius: 15, background: opp.bg, display: 'grid', placeItems: 'center', font: `italic 900 12px ${DISPLAY}` }}>{opp.ini}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, flex: 1 }}>{oppName}</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#93A0B8' }}>AVG OVR</span>
        <span className="vb-num" style={{ fontSize: 22, color: '#8EB1F5' }}>{aB ?? '—'}</span>
      </div>
      <div style={{ flex: 'none', padding: '4px 14px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }} aria-label={`${oppName} lineup`}>
        <Slots picks={dB} side="B" />
      </div>

      <div style={{ flex: 'none', margin: '10px 14px 8px', minHeight: 54, borderRadius: 18, display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px 6px 8px', transition: 'all .3s',
        background: myTurn ? 'linear-gradient(90deg,rgba(150,36,50,.45),rgba(13,21,38,.9))' : 'linear-gradient(90deg,rgba(47,85,150,.35),rgba(13,21,38,.9))',
        border: `1px solid ${myTurn ? 'rgba(229,72,77,.55)' : 'rgba(142,177,245,.3)'}` }} aria-live="polite">
        <div style={{ position: 'relative', width: 42, height: 42, flex: 'none' }}>
          <svg width="42" height="42" viewBox="0 0 42 42" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx="21" cy="21" r="18" fill="none" stroke="rgba(142,177,245,.18)" strokeWidth="4" />
            <circle cx="21" cy="21" r="18" fill="none" stroke={ringColor} strokeWidth="4" strokeLinecap="round" strokeDasharray="113.1" strokeDashoffset={ringOffset.toFixed(1)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <span className="vb-num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 16 }}>{done ? '✓' : myTurn ? Math.max(0, clock) : '…'}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="vb-display" style={{ fontSize: 21, lineHeight: 1, letterSpacing: '.03em', color: done ? '#3DD68C' : myTurn ? '#F2666B' : '#8EB1F5' }}>
            {done ? 'DRAFT COMPLETE' : myTurn ? 'YOUR PICK' : `${oppName.toUpperCase()} PICKING…`}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#C3CBDA' }}>
            {done ? `Avg OVR ${aA} vs ${aB}` : `Pick ${taken.length + 1} of ${DRAFT_PICKS} · ${myTurn ? 'auto-picks best at 0' : 'you’re next'}`}
          </span>
        </div>
        {done && (
          <button type="button" onClick={() => onStart(dA, dB)} className="vb-btn-primary vb-press vb-display" autoFocus
            style={{ height: 36, padding: '0 12px', borderRadius: 12, display: 'flex', alignItems: 'center', fontSize: 16, letterSpacing: '.05em' }}>START MATCH</button>
        )}
      </div>

      <div role="radiogroup" aria-label="Filter by position" style={{ flex: 'none', display: 'flex', gap: 6, padding: '0 14px 8px' }}>
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" role="radio" aria-checked={filt === f} onClick={() => setFilt(f)}
            style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12, fontWeight: 800, background: filt === f ? '#F2F4F8' : '#18233A', color: filt === f ? '#0B111D' : '#C3CBDA', display: 'flex', alignItems: 'center' }}>{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: '#8390A8', alignSelf: 'center' }}>BY OVR</span>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 14px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pool.map((p) => {
          const open = slotOpen(dA, p.pos);
          return <PlayerCard key={p.id} p={p} size="row" actionLabel={open ? 'PICK' : 'FULL'} disabled={!myTurn || !open} dim={!open}
            onAction={() => { if (myTurn && open) pick('A', p.id); }} />;
        })}
      </div>

      <div style={{ flex: 'none', padding: '8px 14px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', borderTop: '1px solid rgba(142,177,245,.12)', background: 'linear-gradient(0deg,rgba(217,58,64,.12),transparent)' }} aria-label="Your lineup">
        <Slots picks={dA} side="A" />
      </div>
      <div style={{ flex: 'none', padding: '6px 14px 14px', display: 'flex', alignItems: 'center', gap: 10, height: 52 }}>
        <span style={{ width: 30, height: 30, borderRadius: 15, background: me.bg, border: '1.5px solid #E5484D', display: 'grid', placeItems: 'center', font: `italic 900 12px ${DISPLAY}` }}>{me.ini}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.signedIn ? `${me.handle} · You` : 'You'}</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#93A0B8' }}>AVG OVR</span>
        <span className="vb-num" style={{ fontSize: 22, color: '#F2666B' }}>{aA ?? '—'}</span>
      </div>
    </div>
  );
}
