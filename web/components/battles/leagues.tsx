'use client';

import { DISPLAY, Icon, TopBar } from './ui';

/** One of your season-long fantasy leagues, as app/page.tsx loads it from the API. */
export interface MyLeague {
  id: string; name: string; sport: string; sportName: string; season: string;
  team: string | null; rank: number | null; teams: number; points: number | null; filled: number | null; size: number | null;
}

const SHORT: Record<string, string> = {
  usports_mbk: 'MBB', usports_wbk: 'WBB', usports_fb: 'FB', usports_mhk: 'MHK', usports_whk: 'WHK',
  usports_mvb: 'MVB', usports_wvb: 'WVB', usports_msoc: 'MSOC', usports_wsoc: 'WSOC',
};

export function LeaguesScreen({ leagues, signedIn, onBack }: { leagues: MyLeague[]; signedIn: boolean; onBack: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="My Leagues" onBack={onBack} />
      {leagues.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 28px 60px', textAlign: 'center' }}>
          <div className="vb-tile" style={{ width: 96, height: 96, display: 'grid', placeItems: 'center' }}><Icon name="emoji_events" size={44} color="#8EB1F5" /></div>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{signedIn ? 'No leagues yet' : 'Sign in to see your leagues'}</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: '#93A0B8' }}>
            Season-long fantasy leagues score real U Sports box scores all season. Creating and joining leagues here in Battles is coming next.
          </span>
          {!signedIn && <a href="/login" className="vb-btn-primary vb-press" style={{ marginTop: 8, height: 48, padding: '0 22px', borderRadius: 16, display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: 800, color: '#fff', textDecoration: 'none' }}>Sign in</a>}
        </div>
      ) : (
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="vb-label">Season-long · {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}</span>
          {leagues.map((l, i) => (
            <div key={l.id} className={i === 0 ? 'vb-tile-blue' : 'vb-tile'} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, flex: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 44, height: 44, flex: 'none', borderRadius: 12, background: '#1B3157', boxShadow: 'inset 0 -2px 0 #2F5596', display: 'grid', placeItems: 'center', font: `700 13px ${DISPLAY}`, letterSpacing: '.04em', color: '#C3CBDA' }}>{SHORT[l.sport] ?? '•'}</span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="vb-display" style={{ fontSize: 24, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#C3CBDA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.team ?? 'Commissioner'} · {l.sportName} · {l.season}</span>
                </div>
              </div>
              {l.rank !== null && (
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <span><span className="vb-num" style={{ fontSize: 34, lineHeight: 0.9 }}>#{l.rank}</span><span className="vb-num" style={{ fontSize: 18, color: '#93A0B8' }}> / {l.teams}</span></span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span className="vb-num" style={{ fontSize: 28, lineHeight: 0.9, color: '#8EB1F5' }}>{(l.points ?? 0).toFixed(1)}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: '#93A0B8' }}>ROSTER PTS</span>
                  </span>
                </div>
              )}
              {l.size ? (
                <div role="progressbar" aria-label="Roster filled" aria-valuenow={l.filled ?? 0} aria-valuemin={0} aria-valuemax={l.size}
                  style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ height: 5, borderRadius: 3, background: 'rgba(142,177,245,.15)', overflow: 'hidden' }}>
                    <div style={{ width: `${((l.filled ?? 0) / l.size) * 100}%`, height: '100%', background: '#D93A40', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#93A0B8' }}>Roster {l.filled}/{l.size} · {l.teams} {l.teams === 1 ? 'team' : 'teams'}</span>
                </div>
              ) : null}
            </div>
          ))}
          <p style={{ fontSize: 12, lineHeight: 1.5, color: '#8390A8', textAlign: 'center', padding: '6px 8px' }}>
            Rosters, lineups and the league draft are coming to Battles next.
          </p>
        </div>
      )}
    </div>
  );
}
