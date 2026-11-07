'use client';

import { C, FB, MY_BASE, OPP_TEAM, ME_TEAM, full, gs } from './data';
import { useStore } from './store';
import { Dot, Icon, List, SectionHead, UniMark, num } from './ui';

export function WinBar({ win }: { win: number }) {
  const pct = `${(win * 100).toFixed(0)}%`;
  return (
    <div role="meter" aria-label="Win probability" aria-valuenow={Math.round(win * 100)} aria-valuemin={0} aria-valuemax={100}
      style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', gap: 2 }}>
      <div style={{ width: pct, background: C.primary, borderRadius: 3, transition: 'width .6s ease' }} />
      <div style={{ flex: 1, background: C.segOn, borderRadius: 3 }} />
    </div>
  );
}

export function HomeScreen() {
  const { st, set, go, toast, openDraft, matchup: m } = useStore();
  const winLabel = `${(m.win * 100).toFixed(0)}%`;

  const leagues = [
    { name: 'OUA Diehards', badge: 'FB', sub: `${ME_TEAM} · Football`, rank: `#${m.myRank} / 10`, pts: `${(MY_BASE + m.my).toFixed(1)} pts`, onClick: () => go('matchup') },
    st.hoopsDrafted
      ? { name: 'Snow Bowl Hoops', badge: 'MBB', sub: "Fast Break Fellas · Men's Basketball", rank: '#4 / 10', pts: '0.0 pts', onClick: () => toast('Season starts Nov 13') }
      : { name: 'Snow Bowl Hoops', badge: 'MBB', sub: 'Draft open now · Snake · 10 teams', draft: true, onClick: openDraft },
    { name: 'Frozen Four', badge: 'WHK', sub: "Five Hole Club · Women's Hockey", rank: '#3 / 8', pts: '412.5 pts', onClick: () => toast('Frozen Four opens in the next build') },
    ...st.extraLeagues.map((l) => ({ ...l, onClick: () => toast(l.toast) })),
  ] as { name: string; badge: string; sub: string; rank?: string; pts?: string; draft?: boolean; onClick: () => void }[];

  const top = FB.slice().sort((a, b) => st.live[b.id]! - st.live[a.id]!).slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: 'vhq-up .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mobile/varsityhq-logo-dark.png" alt="" style={{ height: 36, width: 'auto' }} />
          <h1 style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-.02em' }}>VarsityHQ</h1>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" aria-label="Create or join a league" onClick={() => set({ sheet: { type: 'league' }, mode: 'create' })}
            style={{ width: 44, height: 44, borderRadius: 22, background: C.surface2, display: 'grid', placeItems: 'center' }}>
            <Icon name="add" size={22} />
          </button>
          <div aria-label="Your profile" role="img" style={{ width: 44, height: 44, borderRadius: 22, background: '#1B3157', color: C.text, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14 }}>KM</div>
        </div>
      </div>

      <button type="button" onClick={() => go('matchup')} className="vhq-press"
        style={{ margin: '0 16px', borderRadius: 22, background: C.surface, border: '1px solid rgba(255,255,255,.06)', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted }}>
            <Dot color={C.green} size={7} pulse />Game day · OUA Diehards
          </div>
          <Icon name="chevron_right" size={20} color={C.dim} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'end', gap: 8, width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{ME_TEAM}</span>
            <span style={{ ...num(44, m.my >= m.op ? C.text : C.muted, 600, 1), letterSpacing: '-.01em' }}>{m.my.toFixed(1)}</span>
            <span style={{ fontSize: 11, color: C.dim }}>Proj {m.myP.toFixed(1)}</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.faint, paddingBottom: 22 }}>VS</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', textAlign: 'right' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{OPP_TEAM}</span>
            <span style={{ ...num(44, m.op > m.my ? C.text : C.muted, 600, 1), letterSpacing: '-.01em' }}>{m.op.toFixed(1)}</span>
            <span style={{ fontSize: 11, color: C.dim }}>Proj {m.opP.toFixed(1)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          <WinBar win={m.win} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: C.muted }}>
            <span>{winLabel} win prob.</span><span>3 games live · 1 later</span>
          </div>
        </div>
      </button>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionHead title="My leagues" action="Join with code" onAction={() => set({ sheet: { type: 'league' }, mode: 'join' })} />
        <List>
          {leagues.map((l) => (
            <button key={l.name} type="button" onClick={l.onClick} className="vhq-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, textAlign: 'left' }}>
              <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 12, background: C.raised, display: 'grid', placeItems: 'center', ...num(13, C.text2, 700), letterSpacing: '.04em' }}>{l.badge}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="vhq-ellipsis" style={{ fontSize: 15, fontWeight: 700 }}>{l.name}</span>
                <span className="vhq-ellipsis" style={{ fontSize: 12, color: C.muted }}>{l.sub}</span>
              </span>
              {l.draft ? (
                <span style={{ height: 32, padding: '0 12px', borderRadius: 16, background: C.primary, color: C.ink, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', flex: 'none' }}>Draft room</span>
              ) : (
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flex: 'none' }}>
                  <span style={num(20, undefined, 600, 1)}>{l.rank}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>{l.pts}</span>
                </span>
              )}
            </button>
          ))}
        </List>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionHead title="Top performers today" action="All players" onAction={() => go('players')} />
        <List>
          {top.map((a, i) => (
            <button key={a.id} type="button" onClick={() => set({ sheet: { type: 'player', id: a.id } })} className="vhq-row"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', minHeight: 56, textAlign: 'left' }}>
              <span style={{ width: 14, ...num(14, C.dim), textAlign: 'right' }}>{i + 1}</span>
              <UniMark uni={a.uni} size={32} radius={9} font={11} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{full(a)}</span>
                <span style={{ fontSize: 12, color: C.muted }}>{a.pos} · {gs(a.uni).s}</span>
              </span>
              <span style={num(20, C.blue)}>{st.live[a.id]!.toFixed(1)}</span>
            </button>
          ))}
        </List>
      </section>
    </div>
  );
}
