'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AI_OPP, setPool, simulate, SPORTS, type Match, type Player, type SportId } from './data';
import { DraftScreen } from './draft';
import { HomeScreen } from './home';
import { LiveScreen } from './live';
import { FriendsScreen, LobbyScreen, type Gender } from './lobby';
import { VsScreen } from './match';
import { battleUser, MeProvider, recordResult } from './me';
import { LeaguesScreen, type MyLeague } from './leagues';
import { LadderScreen, ResultScreen } from './result';

type Screen = 'home' | 'lobby' | 'friends' | 'ladder' | 'leagues' | 'vs' | 'draft' | 'live' | 'result';
const LINKABLE = ['home', 'lobby', 'friends', 'ladder', 'leagues'] as const;

/**
 * Draft Battles. Only Play AI is live in the web app: ranked queues, friends,
 * invites and the ladder need real opponents from the API, so those screens
 * say "coming soon" instead of showing made-up users.
 */
export function BattlesApp({ displayName, pools, leagues }: {
  displayName: string | null; pools: { W: Player[]; M: Player[] }; leagues: MyLeague[];
}) {
  const me = useMemo(() => battleUser(displayName), [displayName]);
  const [screen, setScreen] = useState<Screen>('home');
  const [sport, setSport] = useState<SportId>('hockey');
  const [gender, setGender] = useState<Gender>('W');
  const [match, setMatch] = useState<Match | null>(null);
  // Register the real player pool for the chosen division before anything renders.
  const all = useMemo(() => [...pools.W, ...pools.M], [pools]);
  setPool(pools[gender], all);
  const poolSize = pools[gender].length;

  // The screen lives in the URL hash so the browser back button and swipe-back work.
  // (Next's router owns history.state, so the hash is the reliable place for it.)
  const nav = useCallback((to: Screen, replace = false) => {
    setScreen(to);
    const url = to === 'home' ? location.pathname : `#${to}`;
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }, []);
  const back = useCallback(() => history.back(), []);
  useEffect(() => {
    const read = () => {
      const h = location.hash.slice(1);
      // Battle screens need in-memory state, so a reload or a stale entry lands on Home.
      setScreen((LINKABLE as readonly string[]).includes(h) ? (h as Screen) : 'home');
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const playAI = () => { setMatch(null); nav(poolSize >= 12 ? 'vs' : 'lobby'); };
  const sportName = SPORTS.find((s) => s.id === sport)!.name;
  const genderName = gender === 'W' ? "Women's" : "Men's";
  const home = <HomeScreen leagues={leagues} pool={pools.W.length ? pools.W : pools.M} go={(to) => (to === 'ai' ? playAI() : nav(to))} />;

  let body: React.ReactNode;
  switch (screen) {
    case 'home': body = home; break;
    case 'lobby':
      body = <LobbyScreen sport={sport} gender={gender} setSport={setSport} setGender={setGender} onBack={back}
        onAI={playAI} onFriend={() => nav('friends')} poolSize={poolSize} />;
      break;
    case 'friends': body = <FriendsScreen onBack={back} onAI={playAI} />; break;
    case 'leagues': body = <LeaguesScreen leagues={leagues} signedIn={me.signedIn} onBack={back} />; break;
    case 'ladder': body = <LadderScreen onBack={back} onPlay={() => nav('lobby', true)} />; break;
    case 'vs': body = <VsScreen opp={AI_OPP} onDone={() => nav('draft', true)} />; break;
    case 'draft':
      body = <DraftScreen opp={AI_OPP} onStart={(a, b) => {
        setMatch(simulate(a, b, Date.now() % 100000, me.handle, AI_OPP.user));
        nav('live', true);
      }} />;
      break;
    case 'live':
      body = match ? <LiveScreen match={match} opp={AI_OPP} onResult={() => { recordResult(match.winner === 'A' ? 'W' : 'L'); nav('result', true); }} /> : null;
      break;
    case 'result':
      body = match ? <ResultScreen match={match} opp={AI_OPP} label={`${genderName} ${sportName}`} onHome={() => nav('home')} onRematch={() => { setMatch(null); nav('vs', true); }} /> : null;
      break;
  }
  // Live and result need a match; after a reload mid-flow, fall back to Home.
  if (body === null) body = home;

  return (
    <MeProvider me={me}>
      <div className="vb vb-screen" style={{ position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div key={screen} style={{ flex: 1, minHeight: 0, position: 'relative', animation: 'vfade .2s ease' }}>{body}</div>
      </div>
    </MeProvider>
  );
}
