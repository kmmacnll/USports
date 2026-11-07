'use client';

import { C } from './data';
import { DraftRoom } from './draft';
import { HomeScreen } from './home';
import { LeagueScreen } from './league';
import { Eligibility, Welcome } from './onboarding';
import { PlayersScreen } from './players';
import { ScoresScreen } from './scores';
import { Sheets } from './sheets';
import { StoreProvider, useStore, type Tab } from './store';
import { Icon } from './ui';

export function VarsityApp() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

const TABS: [Tab, icon: string, label: string][] = [['home', 'home', 'Home'], ['league', 'trophy', 'League'], ['players', 'person_search', 'Players'], ['scores', 'scoreboard', 'Scores']];

function Shell() {
  const { st, go } = useStore();
  return (
    <div className="vhq" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      {st.stage === 'welcome' && <Welcome />}
      {st.stage === 'elig' && <Eligibility />}
      {st.stage === 'app' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <main className="vhq-noscroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 0 24px' }}>
            {st.tab === 'home' && <HomeScreen />}
            {st.tab === 'league' && <LeagueScreen />}
            {st.tab === 'players' && <PlayersScreen />}
            {st.tab === 'scores' && <ScoresScreen />}
          </main>
          <nav aria-label="Main" style={{ flex: 'none', padding: '6px 8px max(env(safe-area-inset-bottom), 30px)', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: 'rgba(10,15,26,.94)', borderTop: '1px solid rgba(255,255,255,.06)', backdropFilter: 'blur(20px)' }}>
            {TABS.map(([id, icon, label]) => {
              const on = st.tab === id;
              return (
                <button key={id} type="button" aria-current={on ? 'page' : undefined}
                  onClick={() => go(id === 'league' ? st.seg : id)}
                  style={{ height: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: on ? C.primary : C.dim, transition: 'color .2s' }}>
                  <Icon name={icon} size={25} fill={on} />
                  <span style={{ fontSize: 10.5, fontWeight: 700 }}>{label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}
      {st.draftOpen && <DraftRoom />}
      <Sheets />
      <div role="status" aria-live="polite" style={{ position: 'absolute', left: 0, right: 0, bottom: 104, zIndex: 70, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 16px' }}>
        {st.toast && (
          <div key={st.toast.key} style={{ maxWidth: 330, padding: '12px 16px', borderRadius: 14, background: C.text, color: C.dark, fontSize: 13, fontWeight: 700, boxShadow: '0 10px 30px rgba(0,0,0,.4)', animation: 'vhq-toast .25s ease', textAlign: 'center' }}>
            {st.toast.text}
          </div>
        )}
      </div>
    </div>
  );
}
