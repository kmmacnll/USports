'use client';

import { useState } from 'react';

import { avatarAt, DIVISIONS, LADDER_USERS, ME, player, playerOfMatch, type Match, type Opponent } from './data';
import { pad2, useElapsed } from './hooks';
import { DivisionBadge, DISPLAY, Icon, Logo, PlayerCard, TopBar } from './ui';

export const ELO_DELTA = 18;

export function ResultScreen({ match, opp, ranked, onRematch, onHome }: {
  match: Match; opp: Opponent; ranked: boolean; onRematch: () => void; onHome: () => void;
}) {
  const [share, setShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const win = match.winner === 'A';
  const potm = playerOfMatch(match);
  const pm = player(potm.id);
  const oppName = opp.ai ? opp.user : `@${opp.user}`;
  const score = `${match.scoreA}–${match.scoreB}`;
  const vsLine = win ? `@${ME.user} def. ${oppName} · Women's Hockey` : `@${ME.user} vs ${oppName} · Women's Hockey`;
  const delta = win ? ELO_DELTA : -ELO_DELTA;
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
            {ranked ? (
              <div style={{ padding: '10px 12px', borderRadius: 14, background: win ? 'rgba(61,214,140,.1)' : 'rgba(255,107,122,.1)', border: `1px solid ${win ? 'rgba(61,214,140,.35)' : 'rgba(255,107,122,.35)'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <DivisionBadge tier="Varsity" size={30} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#93A0B8' }}>ELO</span>
                  <span style={{ height: 24, overflow: 'hidden', display: 'block' }} aria-label={`Elo ${(ME.elo + delta).toLocaleString()}`}>
                    <span style={{ display: 'flex', flexDirection: 'column', animation: 'velo 1.2s cubic-bezier(.3,.9,.3,1) .5s both' }}>
                      <span className="vb-num" style={{ fontSize: 24, lineHeight: 1, color: '#93A0B8' }}>{ME.elo.toLocaleString()}</span>
                      <span className="vb-num" style={{ fontSize: 24, lineHeight: 1 }}>{(ME.elo + delta).toLocaleString()}</span>
                    </span>
                  </span>
                </div>
                <span style={{ font: `italic 800 22px ${DISPLAY}`, color: ink, animation: 'vpop .5s cubic-bezier(.2,.9,.25,1.4) 1.4s both' }}>{win ? '+' : '−'}{ELO_DELTA}</span>
              </div>
            ) : (
              <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(142,177,245,.08)', border: '1px solid rgba(142,177,245,.2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: '#C3CBDA' }}>UNRANKED · {opp.ai ? 'VS AI' : 'FRIENDLY'}</span>
                <span style={{ fontSize: 12, color: '#93A0B8' }}>Elo and standing unchanged</span>
              </div>
            )}
          </div>
        </div>
        {ranked && (
          <div className="vb-tile" style={{ width: '100%', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="vb-label" style={{ whiteSpace: 'nowrap' }}>Weekly standing · Varsity II</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#C3CBDA' }}>{win ? '1 win from the promotion zone' : 'Still clear of the relegation zone'}</span>
            </div>
            <span className="vb-num" style={{ fontSize: 20, color: '#93A0B8' }}>#7</span>
            <Icon name="arrow_forward" size={18} color="#93A0B8" />
            <span className="vb-num" style={{ fontSize: 26 }}>#{win ? 6 : 9}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: ink }}>{win ? '▲1' : '▼2'}</span>
          </div>
        )}
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
              <span style={{ position: 'relative', fontSize: 9, fontWeight: 800, letterSpacing: '.14em', color: '#8390A8' }}>VARSITYHQ DRAFT BATTLE{ranked ? ` · ${win ? '+' : '−'}${ELO_DELTA} ELO` : ''}</span>
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
const RESET_SECONDS = 2 * 86400 + 14 * 3600 + 22 * 60 + 9;

export function LadderScreen({ onBack }: { onBack: () => void }) {
  const n = useElapsed();
  const rs = Math.max(0, RESET_SECONDS - n);
  const [info, setInfo] = useState(false);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Ranked Ladder" onBack={onBack} right={
        <button type="button" onClick={() => setInfo((v) => !v)} aria-label="How the ladder works" aria-expanded={info} style={{ width: 40, height: 40, borderRadius: 20, background: '#18233A', display: 'grid', placeItems: 'center', color: '#C3CBDA' }}><Icon name="info" size={20} /></button>
      } />
      {info && (
        <p style={{ margin: '4px 14px 8px', padding: '10px 12px', borderRadius: 14, background: '#0D1422', border: '1px solid rgba(142,177,245,.2)', fontSize: 12.5, lineHeight: 1.5, color: '#C3CBDA' }}>
          Ranked wins earn ladder points. Each week, the top 5 in your cohort move up a division and the bottom 5 move down. Unranked battles never change your standing.
        </p>
      )}
      <div className="no-scrollbar" style={{ flex: 'none', display: 'flex', gap: 4, overflowX: 'auto', padding: '8px 14px 12px', alignItems: 'flex-end' }}>
        {DIVISIONS.map((name, i) => (
          <div key={name} style={{ flex: 'none', width: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0', borderRadius: 14, background: i === 3 ? 'rgba(47,85,150,.35)' : 'transparent', border: `1px solid ${i === 3 ? 'rgba(142,177,245,.45)' : 'transparent'}` }} aria-current={i === 3 ? 'true' : undefined}>
            <DivisionBadge tier={name} size={i === 3 ? 40 : 30} locked={i > 3} />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.04em', color: i === 3 ? '#F2F4F8' : i > 3 ? '#8390A8' : '#C3CBDA', textAlign: 'center', lineHeight: 1.15 }}>{name.toUpperCase()}</span>
          </div>
        ))}
      </div>
      <div className="vb-tile" style={{ flex: 'none', margin: '0 14px 10px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>Varsity II · Cohort 18</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#93A0B8' }}>Top 5 promote · bottom 5 relegate</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: '#FF8A3D' }}>RESETS IN</span>
          <span className="vb-num" style={{ fontSize: 19 }}>{Math.floor(rs / 86400)}d {pad2(Math.floor((rs % 86400) / 3600))}:{pad2(Math.floor((rs % 3600) / 60))}:{pad2(rs % 60)}</span>
        </div>
      </div>
      <ol className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 14px 24px', margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {LADDER_USERS.map((u, i) => {
          const r = i + 1, me = u === ME.user, promo = r <= 5, rel = r > 25;
          const w = Math.max(1, 14 - Math.floor(i / 2.5)), l = Math.min(13, 2 + Math.floor(i / 2.2));
          return (
            <li key={u} style={{ display: 'contents' }}>
              {r === 1 && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 2px', fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: '#3DD68C' }}><Icon name="keyboard_double_arrow_up" size={15} />PROMOTION ZONE</div>}
              {r === 6 && <div style={{ height: 1, background: 'rgba(61,214,140,.35)', margin: '6px 0', flex: 'none' }} />}
              {r === 26 && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 2px', fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: '#FF6B7A', borderTop: '1px solid rgba(255,107,122,.35)', marginTop: 4 }}><Icon name="keyboard_double_arrow_down" size={15} />RELEGATION ZONE</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 48, flex: 'none', padding: '0 12px 0 8px', borderRadius: 12,
                background: me ? 'linear-gradient(90deg,rgba(150,36,50,.5),rgba(17,26,42,.9))' : promo ? 'rgba(61,214,140,.07)' : rel ? 'rgba(255,107,122,.07)' : 'rgba(17,26,42,.7)',
                border: `1px solid ${me ? 'rgba(229,72,77,.7)' : 'rgba(142,177,245,.08)'}`, boxShadow: me ? '0 0 18px rgba(217,58,64,.3)' : 'none' }}>
                <span style={{ width: 24, textAlign: 'center', font: `700 16px ${DISPLAY}`, color: promo ? '#3DD68C' : rel ? '#FF6B7A' : '#C3CBDA' }}>{r}</span>
                <span style={{ width: 30, height: 30, borderRadius: 15, background: me ? ME.bg : avatarAt(i), display: 'grid', placeItems: 'center', font: `italic 900 12px ${DISPLAY}`, flex: 'none' }}>{u.replace(/[^a-z]/g, '').slice(0, 2).toUpperCase()}</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: me ? 800 : 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me ? '@kmac · You' : `@${u}`}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#93A0B8', width: 44, textAlign: 'right' }}>{w}–{l}</span>
                <span className="vb-num" style={{ fontSize: 17, width: 40, textAlign: 'right' }}>{Math.max(120, 980 - i * 28 - (i % 3) * 7)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
