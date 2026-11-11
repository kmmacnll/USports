'use client';

import type { CSSProperties, ReactNode } from 'react';

import type { Division, Player } from './data';

export const DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";

export function Icon({ name, size = 20, fill = false, color, style, label }: {
  name: string; size?: number; fill?: boolean; color?: string; style?: CSSProperties; label?: string;
}) {
  return (
    <span className={`vb-icon${fill ? ' vb-icon-fill' : ''}`} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}
      style={{ fontSize: size, color, ...style }}>{name}</span>
  );
}

// ---------- Player card ----------
const TIERS = {
  bronze: { f: 'linear-gradient(135deg,#6E3F22 0%,#D9A273 32%,#7E4A2A 58%,#E8B88C 100%)', ink: '#EBC29C', glow: 'drop-shadow(0 8px 16px rgba(0,0,0,.45))', label: 'BRONZE' },
  silver: { f: 'linear-gradient(135deg,#7D8794 0%,#F1F4F8 32%,#8E98A5 58%,#DCE2EA 100%)', ink: '#E4E9F0', glow: 'drop-shadow(0 8px 16px rgba(0,0,0,.45))', label: 'SILVER' },
  gold: { f: 'linear-gradient(135deg,#8F6A1E 0%,#F5D982 32%,#A97F2A 58%,#FBE9A8 100%)', ink: '#F2CF6B', glow: 'drop-shadow(0 8px 18px rgba(233,185,73,.25))', label: 'GOLD' },
  elite: { f: 'linear-gradient(135deg,#E9B949 0%,#FFF1C4 18%,#D93A40 42%,#8EB1F5 70%,#E9B949 100%)', ink: '#FFE7A3', glow: 'drop-shadow(0 0 14px rgba(217,58,64,.45)) drop-shadow(0 8px 18px rgba(0,0,0,.4))', label: 'ELITE' },
};
export const tierOf = (ovr: number) => (ovr >= 85 ? TIERS.elite : ovr >= 75 ? TIERS.gold : ovr >= 65 ? TIERS.silver : TIERS.bronze);

const CARD_CLIP = 'polygon(0 0,76% 0,100% 16%,100% 87%,50% 100%,0 87%)';
const CARD_CLIP_IN = 'polygon(0 0,75.5% 0,100% 15.5%,100% 87%,50% 100%,0 87%)';
const XS_CLIP = 'polygon(0 0,74% 0,100% 16%,100% 87%,50% 100%,0 87%)';
const XS_CLIP_IN = 'polygon(0 0,73% 0,100% 15%,100% 87%,50% 100%,0 87%)';
export const EMPTY_SLOT_CLIP = XS_CLIP;

/** A school's logo as a small PNG icon (decorative: the school code is always shown as text too). */
export function SchoolLogo({ src, size, style }: { src: string | null; size: number; style?: CSSProperties }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden width={size} height={size} loading="lazy" decoding="async"
    style={{ width: size, height: size, objectFit: 'contain', flex: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.55))', ...style }} />;
}

export function PlayerCard({ p, size = 'lg', actionLabel, onAction, disabled, dim }: {
  p: Player; size?: 'lg' | 'md' | 'xs' | 'row'; actionLabel?: string; onAction?: () => void; disabled?: boolean; dim?: boolean;
}) {
  const T = tierOf(p.ovr);
  const panel = `linear-gradient(165deg,${p.tint}4D 0%,#111C31 46%,#0A101D 100%)`;
  const avatar = `radial-gradient(circle at 35% 30%,${p.tint}B3,#13203A 72%)`;
  const initials = p.first[0]! + p.last[0]!;
  const label = `${p.first} ${p.last}, ${p.pos}, overall ${p.ovr}`;

  if (size === 'xs') {
    return (
      <div role="img" aria-label={label} style={{ width: 52, height: 70, position: 'relative', flex: 'none', filter: T.glow }}>
        <div style={{ position: 'absolute', inset: 0, clipPath: XS_CLIP, background: T.f }} />
        <div style={{ position: 'absolute', inset: 2, clipPath: XS_CLIP_IN, background: panel, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,transparent 36%,rgba(255,255,255,.1) 47%,transparent 58%)' }} />
          <span style={{ position: 'absolute', top: 4, left: 5, font: `italic 800 17px/0.9 ${DISPLAY}`, color: T.ink }}>{p.ovr}</span>
          <span style={{ position: 'absolute', top: 20, left: 5, font: `800 8px ${DISPLAY}`, letterSpacing: '.1em' }}>{p.pos}</span>
          <span style={{ position: 'absolute', top: 24, right: 5, font: `italic 900 13px ${DISPLAY}`, color: 'rgba(242,244,248,.55)' }}>{initials}</span>
          <span style={{ position: 'absolute', top: 40, left: 2, right: 2, textAlign: 'center', font: `700 8.5px/1 ${DISPLAY}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.last.toUpperCase()}</span>
          <span style={{ position: 'absolute', top: 49, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 6.5, fontWeight: 800, color: '#C3CBDA' }}>
            <SchoolLogo src={p.logo} size={9} />{p.school}
          </span>
        </div>
      </div>
    );
  }

  if (size === 'row') {
    const hasAction = !!actionLabel;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 58, paddingRight: 8, borderRadius: 14, flex: 'none', background: 'linear-gradient(90deg,rgba(28,42,70,.95),rgba(15,24,42,.95))', border: '1px solid rgba(142,177,245,.14)', overflow: 'hidden', opacity: dim ? 0.42 : 1, transition: 'opacity .2s' }}>
        <div style={{ width: 4, alignSelf: 'stretch', background: T.f }} />
        <div style={{ width: 40, height: 44, flex: 'none', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(0 0,72% 0,100% 20%,100% 82%,50% 100%,0 82%)', background: T.f }} />
          <div style={{ position: 'absolute', inset: 2, clipPath: 'polygon(0 0,71% 0,100% 19%,100% 82%,50% 100%,0 82%)', background: '#0D1526', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ font: `italic 800 17px/1 ${DISPLAY}`, color: T.ink }}>{p.ovr}</span>
            <span style={{ font: `800 8px ${DISPLAY}`, letterSpacing: '.1em' }}>{p.pos}</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.first[0]}. {p.last}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: '#93A0B8' }}>
            <SchoolLogo src={p.logo} size={14} />{p.school} · #{p.num}
            {p.isNew && <span style={{ padding: '1px 4px', borderRadius: 4, background: '#E9B949', color: '#2A1C02', fontSize: 8, fontWeight: 800 }}>NEW</span>}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,20px)', gap: 1 }}>
          {p.ratings.map((r) => (
            <div key={r.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ font: `700 13px/1.1 ${DISPLAY}` }}>{r.v}</span>
              <span style={{ fontSize: 7, fontWeight: 800, color: '#8390A8' }}>{r.l}</span>
            </div>
          ))}
        </div>
        {hasAction && (
          <button type="button" onClick={() => !disabled && onAction?.()} disabled={disabled} aria-label={`${actionLabel} ${p.first} ${p.last}`}
            style={{ height: 34, minWidth: 44, padding: '0 8px', borderRadius: 11, display: 'grid', placeItems: 'center', font: `italic 800 14px ${DISPLAY}`, letterSpacing: '.06em', textAlign: 'center',
              background: disabled ? 'rgba(142,177,245,.1)' : 'linear-gradient(180deg,#E5484D,#C8323A)', color: disabled ? '#8390A8' : '#FFFFFF', boxShadow: disabled ? 'none' : '0 4px 14px rgba(217,58,64,.45)' }}>
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  // lg / md (md is lg scaled to 76%)
  const scale = size === 'md' ? 0.76 : 1;
  return (
    <div role="img" aria-label={label} style={{ width: 150 * scale, height: 214 * scale, flex: 'none', position: 'relative' }}>
      <div style={{ width: 150, height: 214, position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: 'top left', filter: T.glow }}>
        <div style={{ position: 'absolute', inset: 0, clipPath: CARD_CLIP, background: T.f }} />
        <div style={{ position: 'absolute', inset: 3, clipPath: CARD_CLIP_IN, background: panel, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 1px,transparent 1px 9px)' }} />
          {p.logo && <SchoolLogo src={p.logo} size={118} style={{ position: 'absolute', top: 14, left: 16, opacity: 0.11, filter: 'grayscale(.2)' }} />}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,transparent 36%,rgba(255,255,255,.09) 47%,transparent 58%)' }} />
          <div style={{ position: 'absolute', top: 9, left: 11, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ font: `italic 800 34px/0.9 ${DISPLAY}`, color: T.ink, letterSpacing: '-.01em' }}>{p.ovr}</span>
            <span style={{ font: `800 11px ${DISPLAY}`, letterSpacing: '.14em' }}>{p.pos}</span>
          </div>
          {p.isNew && <span style={{ position: 'absolute', top: 36, right: 8, padding: '2px 6px', borderRadius: 5, background: '#E9B949', color: '#2A1C02', fontSize: 9, fontWeight: 800, letterSpacing: '.08em' }}>NEW</span>}
          <div style={{ position: 'absolute', top: 24, left: 52, width: 74, height: 74, borderRadius: '50%', padding: 2, background: T.f }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: avatar, display: 'grid', placeItems: 'center' }}>
              <span style={{ font: `italic 900 29px ${DISPLAY}`, letterSpacing: '.02em', textShadow: '0 2px 6px rgba(0,0,0,.5)' }}>{initials}</span>
            </div>
          </div>
          <div style={{ position: 'absolute', top: 106, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#C3CBDA' }}>{p.first}</span>
            <span style={{ font: `700 19px/1 ${DISPLAY}`, letterSpacing: '.03em' }}>{p.last.toUpperCase()}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', color: '#C3CBDA', marginTop: 2 }}>
              <SchoolLogo src={p.logo} size={16} />{p.school} · #{p.num}
            </span>
          </div>
          <div style={{ position: 'absolute', top: 152, left: 10, right: 10, height: 1, background: 'rgba(255,255,255,.14)' }} />
          <div style={{ position: 'absolute', top: 157, left: 8, right: 8, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)' }}>
            {p.ratings.map((r) => (
              <div key={r.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ font: `700 14px/1.1 ${DISPLAY}` }}>{r.v}</span>
                <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.04em', color: '#93A0B8' }}>{r.l}</span>
              </div>
            ))}
          </div>
          <span style={{ position: 'absolute', top: 186, left: 0, right: 0, textAlign: 'center', fontSize: 7.5, fontWeight: 800, letterSpacing: '.24em', color: T.ink }}>{T.label}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Division badge ----------
const DIV: Record<Division, { rim: string; fill: string; ink: string; g: string }> = {
  'Walk-On': { rim: 'linear-gradient(160deg,#C3CBDA,#5A667E)', fill: 'linear-gradient(160deg,#3B4A68,#222D44)', ink: '#C3CBDA', g: 'W' },
  Bench: { rim: 'linear-gradient(160deg,#E8B88C,#7E4A2A)', fill: 'linear-gradient(160deg,#9A6038,#5B341C)', ink: '#FCE3C8', g: 'B' },
  Starter: { rim: 'linear-gradient(160deg,#F1F4F8,#7D8794)', fill: 'linear-gradient(160deg,#A3ADBB,#5E6876)', ink: '#FFFFFF', g: 'S' },
  Varsity: { rim: 'linear-gradient(160deg,#E4ECFF,#8EB1F5 40%,#4F6FA8)', fill: 'linear-gradient(160deg,#2F5596,#1B3157)', ink: '#FFFFFF', g: 'V' },
  'All-Star': { rim: 'linear-gradient(160deg,#FBE9A8,#A97F2A)', fill: 'linear-gradient(160deg,#F2CB64,#B8862B)', ink: '#3A2606', g: '★' },
  Captain: { rim: 'linear-gradient(160deg,#FBE9A8,#A97F2A)', fill: 'linear-gradient(160deg,#E5484D,#8E1F27)', ink: '#FFF1C4', g: 'C' },
  'Hall of Fame': { rim: 'linear-gradient(160deg,#FFF1C4,#E9B949 30%,#D93A40 60%,#8EB1F5)', fill: 'linear-gradient(160deg,#1B3157,#0A1222)', ink: '#F2CF6B', g: 'HF' },
};
const HEX = 'polygon(50% 0,100% 19%,100% 64%,50% 100%,0 64%,0 19%)';

export function DivisionBadge({ tier = 'Varsity', size = 48, label = false, locked = false }: {
  tier?: Division; size?: number; label?: boolean; locked?: boolean;
}) {
  const d = DIV[tier];
  const glow = tier === 'Hall of Fame' ? 'drop-shadow(0 0 10px rgba(233,185,73,.55))'
    : tier === 'Captain' || tier === 'All-Star' ? 'drop-shadow(0 0 8px rgba(233,185,73,.35))' : 'drop-shadow(0 4px 8px rgba(0,0,0,.4))';
  return (
    <div role="img" aria-label={`${tier} division${locked ? ' (locked)' : ''}`}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: locked ? 0.38 : 1, flex: 'none' }}>
      <div style={{ width: size, height: Math.round(size * 1.1), position: 'relative', filter: glow }}>
        <div style={{ position: 'absolute', inset: 0, clipPath: HEX, background: d.rim }} />
        <div style={{ position: 'absolute', inset: Math.max(2, Math.round(size / 16)), clipPath: HEX, background: d.fill, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,0) 42%)' }} />
          <span style={{ position: 'relative', font: `italic 900 ${Math.round(size * (d.g.length > 1 ? 0.42 : 0.56))}px ${DISPLAY}`, color: d.ink, textShadow: '0 1px 0 rgba(0,0,0,.35)', marginTop: '-6%' }}>{d.g}</span>
        </div>
      </div>
      {label && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#C3CBDA', whiteSpace: 'nowrap' }}>{tier}</span>}
    </div>
  );
}

// ---------- Small pieces ----------
export function Avatar({ ini, bg, size = 30, ring, fontSize }: { ini: string; bg: string; size?: number; ring?: string; fontSize?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size / 2, background: bg, border: ring ? `1.5px solid ${ring}` : undefined, display: 'grid', placeItems: 'center', flex: 'none',
      font: `italic 900 ${fontSize ?? Math.round(size * 0.4)}px ${DISPLAY}` }}>{ini}</span>
  );
}

export function RingAvatar({ ini, size = 92, from = '#E5484D', to = '#8EB1F5', bg }: { ini: string; size?: number; from?: string; to?: string; bg: string }) {
  return (
    <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', padding: 3, background: `linear-gradient(160deg,${from},${to})`, flex: 'none' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: bg, display: 'grid', placeItems: 'center', font: `italic 900 ${Math.round(size * 0.37)}px ${DISPLAY}` }}>{ini}</div>
    </div>
  );
}

export function LiveDot({ size = 6 }: { size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: size / 2, background: '#FF8A3D', animation: 'vpulse 1.4s infinite', flex: 'none' }} />;
}

export function Chip({ children, tone = 'live', style }: { children: ReactNode; tone?: 'live' | 'muted' | 'blue'; style?: CSSProperties }) {
  const tones = {
    live: { background: 'rgba(255,138,61,.16)', color: '#FF8A3D' },
    muted: { background: 'rgba(142,177,245,.12)', color: '#C3CBDA' },
    blue: { background: 'rgba(142,177,245,.2)', color: '#C9DAFB' },
  };
  return (
    <span style={{ height: 26, padding: '0 10px', borderRadius: 13, fontSize: 11, fontWeight: 800, letterSpacing: '.08em', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', ...tones[tone], ...style }}>
      {children}
    </span>
  );
}

export function ResultPip({ r, size = 24 }: { r: 'W' | 'L'; size?: number }) {
  const w = r === 'W';
  return (
    <span aria-label={w ? 'Win' : 'Loss'} style={{ width: size, height: size, borderRadius: 7, background: w ? 'rgba(61,214,140,.16)' : 'rgba(255,107,122,.16)', color: w ? '#3DD68C' : '#FF6B7A', font: `800 13px ${DISPLAY}`, display: 'grid', placeItems: 'center' }}>{r}</span>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px 0 8px', height: 48, flex: 'none', marginTop: 8 }}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back" style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: '#C3CBDA' }}>
          <Icon name="arrow_back_ios_new" size={24} />
        </button>
      ) : <span style={{ width: 8 }} />}
      <h1 className="vb-display" style={{ flex: 1, fontSize: 28, margin: 0, lineHeight: 1 }}>{title}</h1>
      {right}
    </div>
  );
}

/** Rank / record / streak strip. Everything here is your own: unranked until ranked play exists. */
export function HudBar({ played, wins, losses, streak }: { played: number; wins: number; losses: number; streak: number }) {
  const pct = played ? Math.round((wins / played) * 100) : 0;
  return (
    <div style={{ flex: 'none', margin: '0 10px', height: 54, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(16px 0,100% 0,calc(100% - 16px) 100%,0 100%)', background: 'linear-gradient(90deg,rgba(27,49,87,.96),rgba(17,26,42,.94) 58%,rgba(70,24,32,.92))' }} />
      <div style={{ position: 'absolute', left: 16, right: 0, top: 0, height: 1, background: 'linear-gradient(90deg,rgba(142,177,245,.6),rgba(229,72,77,.6))' }} />
      <div style={{ position: 'absolute', left: 0, right: 16, bottom: 0, height: 1, background: 'linear-gradient(90deg,rgba(142,177,245,.25),rgba(229,72,77,.35))' }} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px 0 16px' }}>
        <DivisionBadge tier="Walk-On" size={34} locked />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: '#93A0B8' }}>UNRANKED</span>
          <span className="vb-num" style={{ fontSize: 20, lineHeight: 1.05 }}>{played} <span style={{ fontSize: 11, color: '#93A0B8' }}>{played === 1 ? 'BATTLE' : 'BATTLES'}</span></span>
        </div>
        <div style={{ width: 1, height: 28, background: 'rgba(142,177,245,.3)', transform: 'skewX(-18deg)' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ font: `italic 800 16px/1 ${DISPLAY}` }}><span style={{ fontSize: 11, color: '#93A0B8' }}>W–L</span> {wins}–{losses}</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#93A0B8' }}>{played ? `${pct}% wins` : 'No battles yet'}</span>
          </div>
          <div role="progressbar" aria-label="Win rate" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 5, borderRadius: 3, background: 'rgba(142,177,245,.15)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#8EB1F5,#F2F4F8)', borderRadius: 3 }} />
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'rgba(142,177,245,.3)', transform: 'skewX(-18deg)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, opacity: streak ? 1 : 0.45 }} aria-label={`${streak} win streak`}>
          <Icon name="local_fire_department" size={22} fill color="#FF8A3D" style={{ filter: streak ? 'drop-shadow(0 0 6px rgba(255,138,61,.6))' : 'none' }} />
          <span style={{ font: `italic 800 22px/1 ${DISPLAY}` }}>{streak}</span>
        </div>
      </div>
    </div>
  );
}

export function PlayRandomButton({ onClick, disabled, sub }: { onClick: () => void; disabled?: boolean; sub: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="vb-press"
      style={{ height: 78, borderRadius: 22, background: disabled ? 'linear-gradient(180deg,#3A4258,#262D3F)' : 'linear-gradient(180deg,#E5484D,#B82E34)', animation: disabled ? 'none' : 'vglow 2.2s ease-in-out infinite',
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px 0 16px', position: 'relative', overflow: 'hidden', flex: 'none', width: '100%', textAlign: 'left' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,transparent 30%,rgba(255,255,255,.18) 45%,transparent 60%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(115deg,transparent 0 22px,rgba(255,255,255,.05) 22px 24px)' }} />
      <DivisionBadge tier="Varsity" size={40} />
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ font: `italic 900 33px/0.92 ${DISPLAY}`, letterSpacing: '.04em', color: '#FFFFFF', textShadow: '0 2px 0 rgba(90,10,18,.55)' }}>PLAY RANDOM</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', color: '#FFFFFF' }}>{sub}</span>
      </div>
      <Icon name="chevron_right" size={32} color="#FFFFFF" style={{ position: 'relative' }} />
    </button>
  );
}

export const Logo = ({ height = 40 }: { height?: number }) => (
  <img src="/battles/varsityhq-logo-dark.png" alt="VarsityHQ" style={{ height, width: 'auto' }} />
);
