'use client';

import { useState } from 'react';

import { ME, type Opponent } from './data';
import { pad2, useElapsed, useTimeout } from './hooks';
import { DivisionBadge, DISPLAY, Icon, LiveDot, RingAvatar } from './ui';

const GIVE_UP_AFTER = 90; // seconds before "No opponent found"

/** Ranked queue. "Keep searching" remounts the search so its clock restarts. */
export function MatchmakingScreen(props: { queueLabel: string; onFound: () => void; onCancel: () => void; onPlayAI: () => void }) {
  const [attempt, setAttempt] = useState(0);
  return <Search key={attempt} {...props} onRetry={() => setAttempt((a) => a + 1)} />;
}

function Search({ queueLabel, onFound, onCancel, onPlayAI, onRetry }: {
  queueLabel: string; onFound: () => void; onCancel: () => void; onPlayAI: () => void; onRetry: () => void;
}) {
  // Demo matchmaking: usually finds someone in 6–14s; sometimes the queue stays quiet.
  const [foundAfter] = useState(() => (Math.random() < 0.85 ? 6 + Math.floor(Math.random() * 9) : null));
  const sec = useElapsed(1000);
  const gaveUp = sec >= GIVE_UP_AFTER;
  useTimeout(onFound, foundAfter === null ? null : foundAfter * 1000);

  if (gaveUp) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 28px', textAlign: 'center' }}>
        <div style={{ width: 96, height: 96, borderRadius: '50%', border: '2px dashed rgba(142,177,245,.35)', display: 'grid', placeItems: 'center', color: '#93A0B8' }}><Icon name="person_search" size={40} /></div>
        <span style={{ fontSize: 20, fontWeight: 800 }}>No opponent found</span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: '#93A0B8' }}>We searched Starter I to All-Star III for 1:30. Ranked queues are quiet right now.</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 8 }}>
          <button type="button" onClick={onRetry} className="vb-btn vb-btn-primary vb-display" style={{ height: 52, fontSize: 20, letterSpacing: '.05em' }}>KEEP SEARCHING</button>
          <button type="button" onClick={onPlayAI} className="vb-btn vb-btn-secondary" style={{ height: 52, fontSize: 14 }}>Play AI instead · Unranked</button>
          <button type="button" onClick={onCancel} style={{ height: 44, fontSize: 13, fontWeight: 800, color: '#93A0B8' }}>Back to lobby</button>
        </div>
      </div>
    );
  }

  const wide = sec >= 10;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0 0', flex: 'none' }}>
        <span style={{ height: 28, padding: '0 12px', borderRadius: 14, background: 'rgba(255,138,61,.16)', color: '#FF8A3D', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', display: 'flex', alignItems: 'center', gap: 6 }}><LiveDot />{queueLabel}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <div aria-hidden style={{ position: 'relative', width: 280, height: 280 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(142,177,245,.18)' }} />
          <div style={{ position: 'absolute', inset: 46, borderRadius: '50%', border: '1px solid rgba(142,177,245,.18)' }} />
          <div style={{ position: 'absolute', inset: 92, borderRadius: '50%', border: '1px solid rgba(142,177,245,.22)' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 0deg,rgba(217,58,64,0) 0deg,rgba(217,58,64,0) 280deg,rgba(217,58,64,.5) 360deg)', animation: 'vspin 2.4s linear infinite' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(217,58,64,.6)', animation: 'vring 2.4s ease-out infinite' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(217,58,64,.6)', animation: 'vring 2.4s ease-out 1.2s infinite' }} />
          {([[58, 72, null, null, 12, '.4s'], [null, 120, 52, null, 10, '1.3s'], [120, null, null, 40, 9, '1.9s']] as const).map(([l, t, r, b, s, d], i) => (
            <span key={i} style={{ position: 'absolute', left: l ?? undefined, top: t ?? undefined, right: r ?? undefined, bottom: b ?? undefined, width: s, height: s, borderRadius: s / 2, background: '#8EB1F5', boxShadow: '0 0 12px #8EB1F5', animation: `vblip 2.4s ease-in-out ${d} infinite` }} />
          ))}
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}><RingAvatar ini={ME.ini} bg={ME.bg} size={92} /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', padding: '0 24px' }} aria-live="polite">
          <span className="vb-num" style={{ fontSize: 52, lineHeight: 1 }}>{Math.floor(sec / 60)}:{pad2(sec % 60)}</span>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{wide ? 'Widening search…' : 'Searching your division…'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#93A0B8' }}>{wide ? 'Starter I – All-Star III · Elo ± 150' : 'Varsity II · Elo 1,482 ± 60'}</span>
        </div>
      </div>
      <div style={{ padding: '0 16px 32px', flex: 'none' }}>
        <button type="button" onClick={onCancel} className="vb-btn vb-btn-ghost" style={{ height: 54, width: '100%', fontSize: 15 }}>Cancel</button>
      </div>
    </div>
  );
}

/** VS slam, then a 3-2-1 countdown into the draft. */
export function VsScreen({ opp, ranked, onDone }: { opp: Opponent; ranked: boolean; onDone: () => void }) {
  const n = useElapsed(1000);
  const left = Math.max(1, 4 - n);
  useTimeout(onDone, 4000);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} aria-live="polite">
      <div style={{ position: 'absolute', left: '-12%', right: '-12%', top: 0, height: '52%', background: 'linear-gradient(160deg,rgba(217,58,64,.55),rgba(80,20,30,.3) 60%,transparent)', transformOrigin: 'left', animation: 'vslamL .6s cubic-bezier(.2,.9,.25,1) both', transform: 'skewX(-12deg)' }} />
      <div style={{ position: 'absolute', left: '-12%', right: '-12%', bottom: 0, height: '52%', background: 'linear-gradient(340deg,rgba(47,85,150,.7),rgba(27,49,87,.35) 60%,transparent)', animation: 'vslamR .6s cubic-bezier(.2,.9,.25,1) .08s both', transform: 'skewX(-12deg)' }} />
      <div style={{ position: 'absolute', left: '-10%', right: '-10%', top: '50%', height: 3, background: 'linear-gradient(90deg,transparent,#FF8A3D,#F2F4F8,#FF8A3D,transparent)', transform: 'rotate(-8deg)', boxShadow: '0 0 22px #FF8A3D' }} />
      <div style={{ position: 'absolute', top: '13%', left: 28, display: 'flex', alignItems: 'center', gap: 16, animation: 'vup .5s ease .25s both' }}>
        <RingAvatar ini={ME.ini} bg={ME.bg} size={108} to="#FFF1C4" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="vb-display" style={{ fontSize: 34, lineHeight: 1 }}>@{ME.user}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}><DivisionBadge tier="Varsity" size={22} />Varsity II · 1,482</span>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: '22%', right: 28, display: 'flex', alignItems: 'center', gap: 16, flexDirection: 'row-reverse', textAlign: 'right', animation: 'vup .5s ease .35s both' }}>
        <RingAvatar ini={opp.ini} bg={opp.bg} size={108} from="#8EB1F5" to="#FFF1C4" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className="vb-display" style={{ fontSize: 34, lineHeight: 1 }}>{opp.ai ? opp.user : `@${opp.user}`}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>{opp.line}{!opp.ai && <DivisionBadge tier="Varsity" size={22} />}</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -62, display: 'flex', justifyContent: 'center' }}>
        <span style={{ font: `italic 900 124px/1 ${DISPLAY}`, textShadow: '0 0 30px rgba(255,138,61,.8),0 6px 0 #D93A40', animation: 'vvs .9s cubic-bezier(.2,.9,.25,1.2) both' }}>VS</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, animation: 'vfade .4s ease .9s both' }}>
        <span className="vb-label">{ranked ? 'Ranked · ' : 'Unranked · '}Draft starts in</span>
        <span className="vb-num" style={{ fontSize: 40, lineHeight: 1 }}>{left}</span>
      </div>
    </div>
  );
}
