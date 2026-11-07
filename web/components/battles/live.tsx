'use client';

import { useEffect, useMemo, useState } from 'react';

import { clockAt, OT_START, periodOf, player, type Match, type MatchEvent, type Opponent } from './data';
import { useMe } from './me';
import { DISPLAY, Icon, PlayerCard } from './ui';

const SIDE = {
  A: { ink: '#F2666B', bg: 'rgba(217,58,64,.18)', bd: 'rgba(229,72,77,.5)' },
  B: { ink: '#8EB1F5', bg: 'rgba(142,177,245,.16)', bd: 'rgba(142,177,245,.45)' },
};
const ICON: Partial<Record<MatchEvent['type'], string>> = { shot: 'sports_hockey', save: 'front_hand', turnover: 'swap_horiz', penalty: 'sports', sub: 'sync_alt', highlight: 'bolt' };
const TICK_MS = 250;

function FeedItem({ e, match, oppName, onResult }: { e: MatchEvent; match: Match; oppName: string; onResult: () => void }) {
  const sd = e.side ? SIDE[e.side] : null;
  const score = `${e.scoreA}–${e.scoreB}`;
  if (e.type === 'goal') {
    const meta = `${e.meta ? `${e.meta} · ` : ''}${e.period === 'OT' ? 'OT' : `P${e.period}`} ${e.clock}`;
    return (
      <div style={{ margin: '4px 12px 10px', position: 'relative', overflow: 'hidden', borderRadius: 20, padding: 12, display: 'flex', alignItems: 'center', gap: 12, background: `linear-gradient(115deg,${sd!.bg},rgba(13,21,38,.92) 75%)`, border: `1px solid ${sd!.bd}`, boxShadow: `0 0 24px ${sd!.bg}` }}>
        <PlayerCard p={player(e.playerIds[0]!)} size="xs" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="vb-display" style={{ fontSize: 24, lineHeight: 1, letterSpacing: '.03em', color: sd!.ink }}>GOAL!</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.3 }}>{e.text}</span>
          <span style={{ fontSize: 11, color: '#C3CBDA' }}>{meta}</span>
        </div>
        <span style={{ font: `italic 800 34px/1 ${DISPLAY}`, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
      </div>
    );
  }
  if (e.type === 'period_start' || e.type === 'period_end') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(142,177,245,.28)' }} />
        <span style={{ font: `italic 800 13px ${DISPLAY}`, letterSpacing: '.16em', color: '#C3CBDA' }}>{e.text.toUpperCase()}</span>
        <span style={{ font: `700 13px ${DISPLAY}`, color: '#8390A8' }}>{score}</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(142,177,245,.28)' }} />
      </div>
    );
  }
  if (e.type === 'ot_start') {
    return (
      <div style={{ margin: '8px 12px', padding: '12px 16px', borderRadius: 18, background: 'linear-gradient(100deg,#FF8A3D,#C2551A)', boxShadow: '0 0 26px rgba(255,138,61,.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span className="vb-display" style={{ fontSize: 34, lineHeight: 1, color: '#1F0E02', letterSpacing: '.04em' }}>OVERTIME</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', color: '#2A1306' }}>{e.text.toUpperCase()}</span>
      </div>
    );
  }
  if (e.type === 'final') {
    const win = match.winner === 'A';
    const hi = Math.max(match.scoreA, match.scoreB), lo = Math.min(match.scoreA, match.scoreB);
    return (
      <div className="vb-tile-gold" style={{ margin: '8px 12px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="vb-display" style={{ fontSize: 26, lineHeight: 1 }}>{match.ot ? 'FINAL · OT' : 'FINAL'}</span>
          <span style={{ fontSize: 12, color: '#C3CBDA' }}>{win ? 'You win' : `${oppName} wins`} {hi}–{lo}</span>
        </div>
        <button type="button" onClick={onResult} className="vb-btn-primary vb-press" autoFocus style={{ height: 40, padding: '0 14px', borderRadius: 12, display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 800 }}>See result</button>
      </div>
    );
  }
  const icon = ICON[e.type] ?? 'circle';
  const iconBg = e.type === 'highlight' ? 'rgba(233,185,73,.16)' : e.type === 'penalty' ? 'rgba(255,138,61,.16)' : sd?.bg ?? 'rgba(142,177,245,.1)';
  const iconFg = e.type === 'highlight' ? '#E9B949' : e.type === 'penalty' ? '#FF8A3D' : sd?.ink ?? '#93A0B8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', minHeight: 42 }}>
      <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', background: iconBg, color: iconFg }}><Icon name={icon} size={17} /></span>
      <span style={{ flex: 1, fontSize: 13, lineHeight: 1.35, color: '#C3CBDA' }}>{e.text}</span>
      <span style={{ font: `600 12px ${DISPLAY}`, color: '#8390A8', fontVariantNumeric: 'tabular-nums' }}>{e.clock}</span>
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

export function LiveScreen({ match, opp, onResult }: { match: Match; opp: Opponent; onResult: () => void }) {
  const [warm, setWarm] = useState(true);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const online = useOnline();
  const oppName = opp.ai ? opp.user : `@${opp.user}`;
  const me = useMe();
  const END = match.end;

  useEffect(() => { const w = setTimeout(() => setWarm(false), 1200); return () => clearTimeout(w); }, []);
  useEffect(() => {
    if (warm || !playing) return;
    const iv = setInterval(() => setT((x) => Math.min(END + 0.5, x + 0.25 * speed)), TICK_MS);
    return () => clearInterval(iv);
  }, [warm, playing, speed, END]);

  const n = useMemo(() => { let k = 0; while (k < match.events.length && match.events[k]!.t <= t) k++; return k; }, [t, match]);
  const vis = match.events.slice(0, n);
  const last = vis[vis.length - 1];
  const final = t >= END, ot = t >= OT_START && match.ot;
  const goals = match.events.filter((e) => e.type === 'goal');
  const lastGoal = [...vis].reverse().find((e) => e.type === 'goal');
  const flash = lastGoal && t - lastGoal.t < 1.6 ? `${goals.indexOf(lastGoal) % 2 ? 'vflash2' : 'vflash'} .9s ease` : 'none';
  const m = last?.momentum ?? 0;
  const periodLabel = final ? 'FINAL' : t >= 149.6 && t < OT_START ? 'END 3RD' : ot ? 'OT' : `P${periodOf(t)}`;
  const progress = Math.min(1, t / END) * 100;

  if (warm) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 14px' }} aria-busy="true">
        <div className="vb-shimmer" style={{ height: 120, borderRadius: 20 }} />
        <div style={{ height: 6, borderRadius: 3, background: '#111A2A' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#C3CBDA' }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(142,177,245,.25)', borderTopColor: '#F2666B', animation: 'vspin .8s linear infinite' }} />Warming up the rink…
        </div>
        <div className="vb-shimmer" style={{ height: 84, borderRadius: 18 }} />
        {[0.2, 0.4, 0.6].map((d) => <div key={d} className="vb-shimmer" style={{ height: 40, borderRadius: 12, animationDelay: `${d}s` }} />)}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ flex: 'none', padding: '12px 12px 0', position: 'relative', zIndex: 5 }}>
        <div className="vb-tile" style={{ padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10, opacity: online ? 1 : 0.45 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }} aria-live="polite" aria-label={`Score: you ${last?.scoreA ?? 0}, ${oppName} ${last?.scoreB ?? 0}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800 }}>
                <span style={{ width: 22, height: 22, flex: 'none', borderRadius: 11, background: me.bg, border: '1.5px solid #E5484D', display: 'grid', placeItems: 'center', font: `italic 900 10px ${DISPLAY}` }}>{me.ini}</span><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.handle}</span>
              </span>
              <span key={`a${last?.scoreA}`} style={{ font: `italic 800 54px/0.95 ${DISPLAY}`, fontVariantNumeric: 'tabular-nums', animation: lastGoal?.side === 'A' ? flash : 'none', transformOrigin: 'left center', display: 'inline-block' }}>{last?.scoreA ?? 0}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ height: 22, padding: '0 9px', borderRadius: 11, background: 'rgba(255,138,61,.16)', color: ot ? '#FF8A3D' : '#C3CBDA', font: `italic 800 13px ${DISPLAY}`, letterSpacing: '.1em', display: 'flex', alignItems: 'center' }}>{periodLabel}</span>
              <span className="vb-num" style={{ fontSize: 30, lineHeight: 1 }}>{final ? '0:00' : clockAt(Math.min(t, END))}</span>
              {!final && <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: '#FF8A3D' }}><span style={{ width: 5, height: 5, borderRadius: 3, background: '#FF8A3D', animation: 'vpulse 1.4s infinite' }} />LIVE</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, maxWidth: '100%' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{oppName}</span>
                <span style={{ width: 22, height: 22, borderRadius: 11, background: opp.bg, border: '1.5px solid #8EB1F5', display: 'grid', placeItems: 'center', font: `italic 900 10px ${DISPLAY}`, flex: 'none' }}>{opp.ini}</span>
              </span>
              <span key={`b${last?.scoreB}`} style={{ font: `italic 800 54px/0.95 ${DISPLAY}`, fontVariantNumeric: 'tabular-nums', animation: lastGoal?.side === 'B' ? flash : 'none', transformOrigin: 'right center', display: 'inline-block' }}>{last?.scoreB ?? 0}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', height: 6, alignItems: 'stretch' }} role="meter" aria-label="Momentum" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(m * 100)}>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', background: 'rgba(217,58,64,.12)', borderRadius: '3px 0 0 3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, m) * 100}%`, height: '100%', background: 'linear-gradient(270deg,#E5484D,#F2666B)', transition: 'width .5s' }} />
              </div>
              <div style={{ width: 2, background: '#F2F4F8', margin: '-2px 1px' }} />
              <div style={{ flex: 1, background: 'rgba(142,177,245,.12)', borderRadius: '0 3px 3px 0', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, -m) * 100}%`, height: '100%', background: '#8EB1F5', transition: 'width .5s' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', fontSize: 9, fontWeight: 800, letterSpacing: '.14em', color: '#93A0B8' }}>MOMENTUM</div>
          </div>
        </div>
        <div style={{ margin: '8px 4px 0', height: 3, borderRadius: 2, background: 'rgba(142,177,245,.14)', overflow: 'hidden' }}>
          <div style={{ width: `${progress.toFixed(1)}%`, height: '100%', background: 'linear-gradient(90deg,#E5484D,#FF8A3D)', transition: `width ${TICK_MS}ms linear` }} />
        </div>
      </div>

      {!online && (
        <div role="alert" style={{ margin: '10px 12px 0', padding: '12px 14px', borderRadius: 16, background: 'rgba(255,107,122,.1)', border: '1px solid rgba(255,107,122,.4)', display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <Icon name="wifi_off" size={22} color="#FF6B7A" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>Connection lost</span>
            <span style={{ fontSize: 12, color: '#C3CBDA' }}>The match keeps going on our side. We&apos;ll catch you up when you&apos;re back.</span>
          </div>
        </div>
      )}

      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 0 8px' }} aria-label="Play-by-play">
        <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          {vis.map((e) => (
            <div key={e.id} style={{ animation: 'vslide .45s cubic-bezier(.2,.8,.2,1)' }}>
              <FeedItem e={e} match={match} oppName={oppName} onResult={onResult} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 14px', borderTop: '1px solid rgba(142,177,245,.1)' }}>
        <button type="button" onClick={() => setPlaying((p) => !p)} disabled={final} aria-label={playing ? 'Pause' : 'Play'}
          style={{ height: 34, width: 40, borderRadius: 11, background: '#18233A', display: 'grid', placeItems: 'center', color: '#C3CBDA', opacity: final ? 0.4 : 1 }}>
          <Icon name={playing ? 'pause' : 'play_arrow'} size={20} fill />
        </button>
        {[1, 3, 8].map((s) => (
          <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}
            style={{ height: 34, minWidth: 40, padding: '0 8px', borderRadius: 11, display: 'grid', placeItems: 'center', font: `700 15px ${DISPLAY}`, background: speed === s ? '#F2F4F8' : '#18233A', color: speed === s ? '#0B111D' : '#C3CBDA' }}>{s}×</button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => { setT(END + 0.5); setPlaying(false); }} disabled={final}
          style={{ height: 34, padding: '0 12px', borderRadius: 11, background: 'rgba(255,138,61,.14)', color: '#FF8A3D', fontSize: 12.5, fontWeight: 800, opacity: final ? 0.4 : 1 }}>Skip to final</button>
      </div>

      {ot && t < OT_START + 3.4 && (
        <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'radial-gradient(circle at 50% 50%,rgba(255,138,61,.55),rgba(7,11,21,.92) 70%)', animation: 'vot 3.4s ease both', pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: '-20%', right: '-20%', top: '46%', height: 120, background: 'repeating-linear-gradient(115deg,rgba(255,138,61,0) 0 18px,rgba(255,138,61,.22) 18px 22px)', transform: 'rotate(-8deg)' }} />
          <span style={{ position: 'relative', font: `italic 900 86px/0.9 ${DISPLAY}`, letterSpacing: '.01em', color: '#FFFFFF', textShadow: '0 0 30px rgba(255,138,61,.9),0 5px 0 #C2551A', transform: 'rotate(-6deg)' }}>OVERTIME</span>
          <span style={{ position: 'relative', fontSize: 15, fontWeight: 800, letterSpacing: '.14em', color: '#FFE0C8' }}>3-ON-3 · NEXT GOAL WINS</span>
        </div>
      )}
    </div>
  );
}
