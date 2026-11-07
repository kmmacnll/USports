'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

import type { Player } from './data';
import type { MyLeague } from './leagues';
import { useMe, useRecord } from './me';
import { BellButton, DivisionBadge, DISPLAY, HudBar, Icon, Logo, PlayerCard, ResultPip, SchoolLogo } from './ui';

const PAGES = ['Play', 'Discover', 'Profile'] as const;

function Tile({ children, tone = 'tile', onClick, href, label, style }: {
  children: ReactNode; tone?: 'tile' | 'tile-gold'; onClick?: () => void; href?: string; label?: string; style?: React.CSSProperties;
}) {
  const s: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, minHeight: 0, ...style };
  const cls = `vb-${tone}${onClick || href ? ' vb-press' : ''}`;
  if (href) return <Link href={href} className={cls} style={{ ...s, color: 'inherit', textDecoration: 'none' }} aria-label={label}>{children}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls} style={s} aria-label={label}>{children}</button>;
  return <div className={cls} style={s}>{children}</div>;
}

const TileTitle = ({ children }: { children: ReactNode }) => <span style={{ fontSize: 15, fontWeight: 800 }}>{children}</span>;
const TileSub = ({ children, color = '#93A0B8' }: { children: ReactNode; color?: string }) => (
  <span style={{ fontSize: 11.5, fontWeight: 700, color, display: 'flex', alignItems: 'center', gap: 5, textAlign: 'center' }}>{children}</span>
);

function Hero({ tone, chip, title, sub, onClick, href }: {
  tone: 'primary' | 'blue'; chip: ReactNode; title: [string, string]; sub: string; onClick?: () => void; href?: string;
}) {
  const accent = tone === 'primary' ? 'rgba(255,138,61,.55)' : 'rgba(142,177,245,.6)';
  const body = (
    <>
      <div style={{ position: 'absolute', left: '46%', top: '-30%', width: 2, height: '170%', background: `linear-gradient(transparent,${accent},transparent)`, transform: 'rotate(28deg)' }} />
      <div style={{ position: 'absolute', left: '58%', top: '-30%', width: 1, height: '170%', background: 'linear-gradient(transparent,rgba(242,244,248,.35),transparent)', transform: 'rotate(28deg)' }} />
      {/* Placeholder for the illustrated athlete cutout. */}
      <div aria-hidden style={{ position: 'absolute', right: -28, bottom: 0, width: 190, height: 236, clipPath: 'polygon(34% 0,74% 0,92% 22%,100% 100%,0 100%,10% 46%)', background: 'repeating-linear-gradient(135deg,rgba(142,177,245,.2) 0 6px,rgba(142,177,245,.07) 6px 12px)' }} />
      <div style={{ position: 'relative', padding: 18, display: 'flex', flexDirection: 'column', gap: 10, height: '100%', alignItems: 'flex-start', textAlign: 'left' }}>
        {chip}
        <span className="vb-display" style={{ fontSize: 60, lineHeight: 0.84, textShadow: tone === 'primary' ? '0 4px 24px rgba(217,58,64,.45)' : '0 4px 24px rgba(0,0,0,.6)' }}>{title[0]}<br />{title[1]}</span>
        <span style={{ marginTop: 'auto', fontSize: 12.5, fontWeight: 700, color: '#C3CBDA' }}>{sub}</span>
      </div>
    </>
  );
  const style: React.CSSProperties = { height: 212, position: 'relative', overflow: 'hidden', flex: 'none', display: 'block', width: '100%', color: 'inherit', textDecoration: 'none' };
  const cls = `vb-tile-${tone} vb-press`;
  return href
    ? <Link href={href} className={cls} style={style}>{body}</Link>
    : <button type="button" onClick={onClick} className={cls} style={style}>{body}</button>;
}

export function HomeScreen({ go, pool, leagues }: {
  go: (to: 'lobby' | 'ladder' | 'friends' | 'inbox' | 'leagues' | 'ai') => void; pool: Player[]; leagues: MyLeague[];
}) {
  const me = useMe();
  const rec = useRecord();
  const recent = rec.results.slice(-4);
  // Discover tiles, all from the real rated pool.
  const top = pool.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 2);
  const risers = pool.filter((p) => (p.change ?? 0) > 0).sort((a, b) => b.change! - a.change!).slice(0, 3);
  const bySchool = new Map<string, { name: string; tint: string; logo: string | null; ovrs: number[] }>();
  for (const p of pool) {
    const s = bySchool.get(p.schoolName) ?? { name: p.schoolName, tint: p.tint, logo: p.logo, ovrs: [] };
    s.ovrs.push(p.ovr); bySchool.set(p.schoolName, s);
  }
  // Average of each school's best six (a full lineup), so deep rosters don't win on count alone.
  const schools = [...bySchool.values()].filter((s) => s.ovrs.length >= 3)
    .map((s) => { const best = s.ovrs.sort((a, b) => b - a).slice(0, 6); return { ...s, avg: best.reduce((t, v) => t + v, 0) / best.length }; })
    .sort((a, b) => b.avg - a.avg).slice(0, 3);
  const none = <span style={{ fontSize: 12, fontWeight: 700, color: '#93A0B8', textAlign: 'center' }}>No ratings yet</span>;
  const [page, setPage] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  const scrollTo = (k: number) => {
    const el = pager.current;
    if (el) el.scrollTo({ left: k * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 6px 18px', flex: 'none' }}>
        <Logo height={40} />
        <div style={{ display: 'flex', gap: 8 }}>
          <BellButton count={0} onClick={() => go('inbox')} />
        </div>
      </div>
      <HudBar played={rec.played} wins={rec.wins} losses={rec.losses} streak={rec.streak} />

      <div ref={pager} className="no-scrollbar" aria-label="Home pages"
        onScroll={(e) => { const el = e.currentTarget; const p = Math.round(el.scrollLeft / el.clientWidth); if (p !== page) setPage(p); }}
        style={{ flex: 1, minHeight: 0, display: 'flex', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory' }}>

        {/* PAGE 1 · PLAY */}
        <section aria-label="Play" style={{ width: '100%', flex: 'none', scrollSnapAlign: 'start', padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="no-scrollbar">
          <Hero tone="primary" onClick={() => go('lobby')} title={['Draft', 'Battle']} sub="6 picks · live sim · ~3 min"
            chip={<span style={{ height: 24, padding: '0 9px', borderRadius: 12, background: 'rgba(255,138,61,.18)', color: '#FF8A3D', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 3, background: '#FF8A3D', animation: 'vpulse 1.4s infinite' }} />1V1 · VS AI</span>} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: 'minmax(132px,1fr)', gap: 12, flex: 1, paddingBottom: 6 }}>
            <Tile onClick={() => go('ladder')} label="Ranked Ladder">
              <DivisionBadge tier="Walk-On" size={54} locked />
              <TileTitle>Ranked Ladder</TileTitle>
              <TileSub>Unranked · coming soon</TileSub>
            </Tile>
            <Tile onClick={() => go('ai')} label="Quick Play versus AI">
              <Icon name="smart_toy" size={44} fill color="#8EB1F5" />
              <TileTitle>Quick Play</TileTitle>
              <TileSub>vs AI · Unranked</TileSub>
            </Tile>
            <Tile>
              {recent.length
                ? <div style={{ display: 'flex', gap: 5 }}>{recent.map((r, i) => <ResultPip key={i} r={r} />)}</div>
                : <Icon name="history" size={40} color="#8EB1F5" />}
              <TileTitle>Recent Battles</TileTitle>
              <TileSub>{rec.played ? `${rec.wins}–${rec.losses} vs AI` : 'No battles yet'}</TileSub>
            </Tile>
            <Tile onClick={() => go('friends')} label="Friends">
              <Icon name="group_add" size={42} fill color="#8EB1F5" />
              <TileTitle>Friends</TileTitle>
              <TileSub>Coming soon</TileSub>
            </Tile>
          </div>
        </section>

        {/* PAGE 2 · DISCOVER */}
        <section aria-label="Discover" style={{ width: '100%', flex: 'none', scrollSnapAlign: 'start', padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="no-scrollbar">
          <Hero tone="blue" onClick={() => go('leagues')} title={['My', 'Leagues']}
            sub={leagues.length ? `${leagues.length === 1 ? '1 league' : `${leagues.length} leagues`} · ${leagues[0]!.name}${leagues[0]!.rank ? ` #${leagues[0]!.rank}` : ''}` : 'Season-long fantasy leagues'}
            chip={<span style={{ height: 24, padding: '0 9px', borderRadius: 12, background: 'rgba(142,177,245,.2)', color: '#C9DAFB', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', display: 'flex', alignItems: 'center' }}>SEASON-LONG</span>} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: 'minmax(132px,1fr)', gap: 12, flex: 1, paddingBottom: 6 }}>
            <Tile style={{ alignItems: 'stretch', gap: 7, padding: 14 }}>
              {risers.length ? risers.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, fontWeight: 700 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.last}</span><span style={{ color: '#3DD68C' }}>▲ {p.change}</span>
                </div>
              )) : <span style={{ fontSize: 12, fontWeight: 700, color: '#93A0B8', textAlign: 'center' }}>{pool.length ? 'No rating changes yet' : 'No ratings yet'}</span>}
              <span style={{ fontSize: 15, fontWeight: 800, textAlign: 'center', marginTop: 4 }}>Risers</span>
            </Tile>
            <Tile tone="tile-gold">
              {top.length === 2 ? (
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ transform: 'rotate(-8deg)', marginRight: -14, opacity: 0.9 }}><PlayerCard p={top[1]!} size="xs" /></div>
                  <div style={{ position: 'relative', zIndex: 1 }}><PlayerCard p={top[0]!} size="xs" /></div>
                </div>
              ) : <Icon name="star" size={44} fill color="#E9B949" />}
              <TileTitle>Top Rated</TileTitle>
              <TileSub color="#E9B949">{pool.length ? `${pool.length} rated athletes` : 'No ratings yet'}</TileSub>
            </Tile>
            <Tile style={{ alignItems: 'stretch', gap: 7, padding: 14 }}>
              {schools.length ? schools.map((sc, i) => (
                <div key={sc.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
                  <span style={{ font: `700 14px ${DISPLAY}`, color: i === 0 ? '#E9B949' : '#C3CBDA', width: 10 }}>{i + 1}</span>
                  {sc.logo ? <SchoolLogo src={sc.logo} size={16} /> : <span style={{ width: 8, height: 8, borderRadius: 2, background: sc.tint, flex: 'none' }} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.name}</span>
                </div>
              )) : none}
              <span style={{ fontSize: 15, fontWeight: 800, textAlign: 'center', marginTop: 4 }}>Top Schools</span>
            </Tile>
            <Tile tone="tile-gold">
              <Icon name="military_tech" size={52} fill color="#E9B949" style={{ filter: 'drop-shadow(0 0 12px rgba(233,185,73,.45))' }} />
              <TileTitle>Rewards</TileTitle>
              <TileSub color="#E9B949">Coming soon</TileSub>
            </Tile>
          </div>
        </section>

        {/* PAGE 3 · PROFILE */}
        <section aria-label="Profile" style={{ width: '100%', flex: 'none', scrollSnapAlign: 'start', padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="no-scrollbar">
          <div className="vb-tile-primary" style={{ height: 150, flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px' }}>
            <div style={{ width: 84, height: 84, borderRadius: '50%', padding: 3, background: 'linear-gradient(160deg,#E5484D,#8EB1F5)', flex: 'none' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#2F5596,#0C1628 75%)', display: 'grid', placeItems: 'center', font: `italic 900 32px ${DISPLAY}` }}>{me.ini}</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span className="vb-display" style={{ fontSize: 32, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.handle}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#C3CBDA' }}>Unranked</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#93A0B8' }}>{rec.played ? `${rec.wins}–${rec.losses} · best streak ${rec.best}` : 'No battles yet'}</span>
            </div>
            <DivisionBadge tier="Walk-On" size={52} locked />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: 'minmax(120px,1fr)', gap: 12, flex: 1 }}>
            <Tile>
              <span className="vb-display" style={{ fontSize: 46, lineHeight: 0.9 }}>{rec.played}</span>
              <TileTitle>My Battles</TileTitle>
              <TileSub>vs AI · this device</TileSub>
            </Tile>
            <Tile>
              <span className="vb-display" style={{ fontSize: 46, lineHeight: 0.9, color: '#8EB1F5' }}>{rec.played ? `${Math.round((rec.wins / rec.played) * 100)}%` : '—'}</span>
              <TileTitle>My Stats</TileTitle>
              <TileSub>{rec.played ? `Win rate · ${rec.wins}–${rec.losses}` : 'Win rate'}</TileSub>
            </Tile>
            <Tile>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <DivisionBadge tier="Starter" size={30} locked /><DivisionBadge tier="Varsity" size={40} locked /><DivisionBadge tier="All-Star" size={30} locked />
              </div>
              <TileTitle>Badges</TileTitle>
              <TileSub>Coming soon</TileSub>
            </Tile>
            <Tile onClick={() => go('friends')} label="Friends">
              <Icon name="group" size={40} fill color="#8EB1F5" />
              <TileTitle>Friends</TileTitle>
              <TileSub>Coming soon</TileSub>
            </Tile>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 'none', paddingBottom: 6 }}>
            <div className="vb-tile" style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}><Icon name="settings" size={20} color="#93A0B8" />Settings</div>
            <div className="vb-tile" style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}><Icon name="share" size={20} color="#93A0B8" />Follow Us</div>
          </div>
        </section>
      </div>

      <div role="tablist" aria-label="Home page" style={{ height: 46, flex: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, paddingBottom: 10 }}>
        {PAGES.map((name, k) => (
          <button key={name} type="button" role="tab" aria-selected={page === k} aria-label={name} onClick={() => scrollTo(k)}
            style={{ width: page === k ? 24 : 8, height: 8, borderRadius: 4, background: page === k ? '#F2F4F8' : 'rgba(242,244,248,.3)', transition: 'all .25s' }} />
        ))}
      </div>
    </div>
  );
}
