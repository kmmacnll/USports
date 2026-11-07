'use client';

import { useState } from 'react';

import { DIVISIONS, player, playerOfMatch, type Match, type Opponent } from './data';
import { useMe, useRecord } from './me';
import { DivisionBadge, DISPLAY, Icon, Logo, PlayerCard, TopBar } from './ui';

export function ResultScreen({ match, opp, label, onRematch, onHome }: {
  match: Match; opp: Opponent; label: string; onRematch: () => void; onHome: () => void;
}) {
  const me = useMe();
  const rec = useRecord();
  const [share, setShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const win = match.winner === 'A';
  const potm = playerOfMatch(match);
  const pm = player(potm.id);
  const oppName = opp.ai ? opp.user : `@${opp.user}`;
  const score = `${match.scoreA}–${match.scoreB}`;
  const vsLine = win ? `${me.handle} def. ${oppName} · ${label}` : `${me.handle} vs ${oppName} · ${label}`;
  const ink = win ? '#3DD68C' : '#FF6B7A';
  const shareText = `${win ? 'WIN' : 'LOSS'} ${score}${match.ot ? ' OT' : ''} · ${vsLine} · Player of the match: ${pm.first} ${pm.last} (${potm.line}) · VarsityHQ Draft Battle`;

  const doShare = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'VarsityHQ Draft Battle', text: shareText }); return; }
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
    } catch { /* user cancelled */ }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: win ? 'radial-gradient(80% 40% at 50% 14%,rgba(61,214,140,.22),transparent 70%)' : 'radial-gradient(80% 40% at 50% 14%,rgba(255,107,122,.18),transparent 70%)' }} />
      <div className="no-scrollbar" style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 18px 0', gap: 12 }}>
        <h1 style={{ margin: 0, font: `italic 900 128px/0.82 ${DISPLAY}`, letterSpacing: '-.01em', color: ink, textShadow: win ? '0 0 40px rgba(61,214,140,.55),0 6px 0 rgba(4,33,15,.8)' : '0 0 40px rgba(255,107,122,.4),0 6px 0 rgba(42,7,16,.8)', animation: 'vup .5s cubic-bezier(.2,.9,.25,1.2)' }}>{win ? 'WIN' : 'LOSS'}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="vb-num" style={{ fontSize: 42, lineHeight: 1 }}>{score}</span>
          {match.ot && <span style={{ height: 26, padding: '0 10px', borderRadius: 13, background: '#FF8A3D', color: '#1F0E02', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', display: 'flex', alignItems: 'center' }}>OT</span>}
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#C3CBDA', textAlign: 'center' }}>{vsLine}</span>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', width: '100%' }}>
          <PlayerCard p={pm} size="md" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="vb-label" style={{ color: '#E9B949' }}>Player of the match</span>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{pm.first} {pm.last}</span>
              <span style={{ fontSize: 12, color: '#C3CBDA' }}>{potm.line}</span>
            </div>
              <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(142,177,245,.08)', border: '1px solid rgba(142,177,245,.2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: '#C3CBDA' }}>UNRANKED · {opp.ai ? 'VS AI' : 'FRIENDLY'}</span>
                <span style={{ fontSize: 12, color: '#93A0B8' }}>{rec.played ? `Your record: ${rec.wins}–${rec.losses}${rec.streak > 1 ? ` · ${rec.streak} straight wins` : ''}` : 'Elo and standing unchanged'}</span>
              </div>
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', flex: 'none', padding: '12px 16px 24px', display: 'grid', gridTemplateColumns: '1.5fr 1fr 54px', gap: 8 }}>
        <button type="button" onClick={onRematch} className="vb-btn vb-btn-primary vb-display vb-press" style={{ height: 54, fontSize: 21, letterSpacing: '.05em' }}>REMATCH</button>
        <button type="button" onClick={() => setShare(true)} className="vb-btn-secondary vb-press" style={{ height: 54, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 15, fontWeight: 800 }}><Icon name="ios_share" size={19} />Share</button>
        <button type="button" onClick={onHome} aria-label="Home" className="vb-btn vb-btn-ghost" style={{ height: 54 }}><Icon name="home" size={22} /></button>
      </div>

      {share && (
        <>
          <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(4,7,14,.7)', animation: 'vfade .25s ease' }} onClick={() => setShare(false)} />
          <div role="dialog" aria-modal="true" aria-label="Share result" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 61, borderRadius: '28px 28px 0 0', background: '#111A2A', borderTop: '1px solid rgba(142,177,245,.2)', padding: '10px 18px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, animation: 'vup .35s cubic-bezier(.2,.8,.2,1)' }}>
            <div style={{ width: 38, height: 5, borderRadius: 3, background: '#2C3A57' }} />
            <div className="vb-screen" style={{ width: 270, height: 338, borderRadius: 18, overflow: 'hidden', position: 'relative', border: '1px solid rgba(142,177,245,.25)', boxShadow: '0 20px 40px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 16px', gap: 6 }}>
              <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(70% 45% at 50% 30%,${win ? 'rgba(61,214,140,.22)' : 'rgba(255,107,122,.18)'},transparent 70%)` }} />
              <div style={{ position: 'relative' }}><Logo height={46} /></div>
              <span style={{ position: 'relative', font: `italic 900 84px/0.85 ${DISPLAY}`, color: ink, textShadow: `0 0 24px ${win ? 'rgba(61,214,140,.5)' : 'rgba(255,107,122,.4)'}` }}>{win ? 'WIN' : 'LOSS'}</span>
              <span className="vb-num" style={{ position: 'relative', fontSize: 34, lineHeight: 1 }}>{score} {match.ot && <span style={{ fontSize: 18, color: '#FF8A3D' }}>OT</span>}</span>
              <span style={{ position: 'relative', fontSize: 11, fontWeight: 700, color: '#C3CBDA', textAlign: 'center' }}>{vsLine}</span>
              <div style={{ position: 'relative', marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(13,21,38,.8)', border: '1px solid rgba(233,185,73,.35)', width: '100%' }}>
                <PlayerCard p={pm} size="xs" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: '#E9B949' }}>PLAYER OF THE MATCH</span>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{pm.first} {pm.last}</span>
                  <span style={{ fontSize: 10.5, color: '#C3CBDA' }}>{potm.line}</span>
                </div>
              </div>
              <span style={{ position: 'relative', fontSize: 9, fontWeight: 800, letterSpacing: '.14em', color: '#8390A8' }}>VARSITYHQ DRAFT BATTLE</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%' }}>
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(shareText); setCopied(true); } catch { /* blocked */ } }} className="vb-btn-secondary" style={{ height: 50, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14, fontWeight: 800 }}>
                <Icon name={copied ? 'check' : 'content_copy'} size={19} />{copied ? 'Copied' : 'Copy text'}
              </button>
              <button type="button" onClick={doShare} className="vb-btn-primary" style={{ height: 50, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14, fontWeight: 800 }}>
                <Icon name="ios_share" size={19} />Share to…
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Ranked ladder ----------
/** No ranked users exist yet, so the ladder explains the divisions instead of listing anyone. */
export function LadderScreen({ onBack, onPlay }: { onBack: () => void; onPlay: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Ranked Ladder" onBack={onBack} />
      <div className="no-scrollbar" style={{ flex: 'none', display: 'flex', gap: 4, overflowX: 'auto', padding: '8px 14px 12px', alignItems: 'flex-end' }}>
        {DIVISIONS.map((name) => (
          <div key={name} style={{ flex: 'none', width: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0' }}>
            <DivisionBadge tier={name} size={30} locked />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.04em', color: '#8390A8', textAlign: 'center', lineHeight: 1.15 }}>{name.toUpperCase()}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 28px 60px', textAlign: 'center' }}>
        <div className="vb-tile" style={{ width: 96, height: 96, display: 'grid', placeItems: 'center' }}><Icon name="military_tech" size={44} color="#E9B949" /></div>
        <span style={{ fontSize: 20, fontWeight: 800 }}>You’re unranked</span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: '#93A0B8' }}>
          Ranked battles are coming soon. Wins will earn ladder points, and each week the top 5 in a cohort move up a division while the bottom 5 move down.
        </span>
        <button type="button" onClick={onPlay} className="vb-btn-primary vb-press" style={{ marginTop: 8, height: 48, padding: '0 20px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}>
          <Icon name="smart_toy" size={19} />Practice vs AI
        </button>
      </div>
    </div>
  );
}
