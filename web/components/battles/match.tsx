'use client';

import { type Opponent } from './data';
import { useElapsed, useTimeout } from './hooks';
import { useMe, useRecord } from './me';
import { DISPLAY, RingAvatar } from './ui';

/** VS slam, then a 3-2-1 countdown into the draft. */
export function VsScreen({ opp, onDone }: { opp: Opponent; onDone: () => void }) {
  const me = useMe();
  const rec = useRecord();
  const n = useElapsed(1000);
  const left = Math.max(1, 4 - n);
  useTimeout(onDone, 4000);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} aria-live="polite">
      <div style={{ position: 'absolute', left: '-12%', right: '-12%', top: 0, height: '52%', background: 'linear-gradient(160deg,rgba(217,58,64,.55),rgba(80,20,30,.3) 60%,transparent)', transformOrigin: 'left', animation: 'vslamL .6s cubic-bezier(.2,.9,.25,1) both', transform: 'skewX(-12deg)' }} />
      <div style={{ position: 'absolute', left: '-12%', right: '-12%', bottom: 0, height: '52%', background: 'linear-gradient(340deg,rgba(47,85,150,.7),rgba(27,49,87,.35) 60%,transparent)', animation: 'vslamR .6s cubic-bezier(.2,.9,.25,1) .08s both', transform: 'skewX(-12deg)' }} />
      <div style={{ position: 'absolute', left: '-10%', right: '-10%', top: '50%', height: 3, background: 'linear-gradient(90deg,transparent,#FF8A3D,#F2F4F8,#FF8A3D,transparent)', transform: 'rotate(-8deg)', boxShadow: '0 0 22px #FF8A3D' }} />
      <div style={{ position: 'absolute', top: '13%', left: 28, display: 'flex', alignItems: 'center', gap: 16, animation: 'vup .5s ease .25s both' }}>
        <RingAvatar ini={me.ini} bg={me.bg} size={108} to="#FFF1C4" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="vb-display" style={{ fontSize: 34, lineHeight: 1, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.handle}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{rec.played ? `${rec.wins}–${rec.losses} vs AI` : 'First battle'}</span>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: '22%', right: 28, display: 'flex', alignItems: 'center', gap: 16, flexDirection: 'row-reverse', textAlign: 'right', animation: 'vup .5s ease .35s both' }}>
        <RingAvatar ini={opp.ini} bg={opp.bg} size={108} from="#8EB1F5" to="#FFF1C4" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className="vb-display" style={{ fontSize: 34, lineHeight: 1 }}>{opp.ai ? opp.user : `@${opp.user}`}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{opp.line}</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -62, display: 'flex', justifyContent: 'center' }}>
        <span style={{ font: `italic 900 124px/1 ${DISPLAY}`, textShadow: '0 0 30px rgba(255,138,61,.8),0 6px 0 #D93A40', animation: 'vvs .9s cubic-bezier(.2,.9,.25,1.2) both' }}>VS</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, animation: 'vfade .4s ease .9s both' }}>
        <span className="vb-label">Unranked · Draft starts in</span>
        <span className="vb-num" style={{ fontSize: 40, lineHeight: 1 }}>{left}</span>
      </div>
    </div>
  );
}
