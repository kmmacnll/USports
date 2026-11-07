'use client';

import { useCallback, useEffect, useState } from 'react';

import { AI_OPP, FRIENDS, INBOX, JAYBIRD, simulate, SPORTS, avatarBg, type InboxItem, type Match, type Opponent, type SportId } from './data';
import { DraftScreen } from './draft';
import { HomeScreen } from './home';
import { useTimeout } from './hooks';
import { LiveScreen } from './live';
import { FriendsScreen, InboxScreen, InviteBanner, InviteModal, LobbyScreen, type Gender } from './lobby';
import { MatchmakingScreen, VsScreen } from './match';
import { LadderScreen, ResultScreen } from './result';

type Screen = 'home' | 'lobby' | 'friends' | 'inbox' | 'ladder' | 'matchmaking' | 'vs' | 'draft' | 'live' | 'result';
type Mode = 'ranked' | 'ai' | 'friend';
const LINKABLE = ['home', 'lobby', 'friends', 'inbox', 'ladder'] as const;

const INVITE_SECONDS = 60;
const FRIEND_ACCEPTS_AFTER = 5; // demo: online friends accept a few seconds after an invite

export function BattlesApp() {
  const [screen, setScreen] = useState<Screen>('home');
  const [sport, setSport] = useState<SportId>('hockey');
  const [gender, setGender] = useState<Gender>('W');
  const [mode, setMode] = useState<Mode>('ranked');
  const [opp, setOpp] = useState<Opponent>(JAYBIRD);
  const [match, setMatch] = useState<Match | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>(INBOX);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [banner, setBanner] = useState<'hidden' | 'shown' | 'modal' | 'done'>('hidden');

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

  // Pending friend invites count down; online friends accept after a few seconds.
  useEffect(() => {
    if (!Object.keys(pending).length) return;
    const iv = setInterval(() => {
      setPending((p) => {
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(p)) if (v > 1) next[k] = v - 1;
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [pending]);
  useEffect(() => {
    if (screen !== 'friends') return;
    const accepted = Object.entries(pending).find(([name, left]) =>
      FRIENDS.find((f) => f.name === name)?.online && INVITE_SECONDS - left >= FRIEND_ACCEPTS_AFTER);
    if (!accepted) return;
    const f = FRIENDS.find((x) => x.name === accepted[0])!;
    setPending((p) => { const n = { ...p }; delete n[f.name]; return n; });
    startBattle('friend', { user: f.name, ini: f.ini, bg: avatarBg(f.tint), line: f.sub });
  }); // re-checks each countdown tick

  // A friend's challenge arrives as a banner shortly after you land on Home.
  useTimeout(() => setBanner((b) => (b === 'hidden' ? 'shown' : b)), screen === 'home' && banner === 'hidden' ? 4000 : null);

  const startBattle = (m: Mode, o: Opponent) => {
    setMode(m); setOpp(o); setMatch(null);
    nav(m === 'ranked' ? 'matchmaking' : 'vs');
  };
  const acceptInvite = () => {
    setBanner('done');
    setInbox((xs) => xs.map((n) => (n.id === 'n1' ? { ...n, chip: 'ACCEPTED', sub: "Hockey · Women's · Unranked" } : n)));
    startBattle('friend', JAYBIRD);
  };
  const declineInvite = () => {
    setBanner('done');
    setInbox((xs) => xs.map((n) => (n.id === 'n1' && n.chip === 'PENDING' ? { ...n, chip: 'DECLINED', title: '@jaybird challenged you' } : n)));
  };

  const sportName = SPORTS.find((s) => s.id === sport)!.name;
  const genderName = gender === 'W' ? "Women's" : "Men's";
  const inboxCount = inbox.filter((n) => n.chip === 'PENDING').length;

  let body: React.ReactNode;
  switch (screen) {
    case 'home':
      body = <HomeScreen inboxCount={inboxCount} go={(to) => (to === 'ai' ? startBattle('ai', AI_OPP) : nav(to))} />;
      break;
    case 'lobby':
      body = <LobbyScreen sport={sport} gender={gender} setSport={setSport} setGender={setGender} onBack={back} onInbox={() => nav('inbox')} inboxCount={inboxCount}
        onRandom={() => startBattle('ranked', JAYBIRD)} onAI={() => startBattle('ai', AI_OPP)} onFriend={() => nav('friends')} />;
      break;
    case 'friends':
      body = <FriendsScreen sportName={sportName} genderName={genderName} pending={pending} onBack={back}
        invite={(name) => setPending((p) => ({ ...p, [name]: INVITE_SECONDS }))}
        cancel={(name) => setPending((p) => { const n = { ...p }; delete n[name]; return n; })} />;
      break;
    case 'inbox':
      body = <InboxScreen items={inbox} sent={Object.keys(pending)} onBack={back} onClear={() => setInbox([])}
        onAccept={() => acceptInvite()} onDecline={() => declineInvite()} onChallenge={() => nav('friends', true)} />;
      break;
    case 'ladder':
      body = <LadderScreen onBack={back} />;
      break;
    case 'matchmaking':
      body = <MatchmakingScreen queueLabel={`RANKED · ${genderName.toUpperCase()} ${sportName.toUpperCase()}`}
        onFound={() => nav('vs', true)} onCancel={back} onPlayAI={() => { setMode('ai'); setOpp(AI_OPP); nav('vs', true); }} />;
      break;
    case 'vs':
      body = <VsScreen opp={opp} ranked={mode === 'ranked'} onDone={() => nav('draft', true)} />;
      break;
    case 'draft':
      body = <DraftScreen opp={opp} onStart={(a, b) => {
        setMatch(simulate(a, b, Date.now() % 100000, '@kmac', opp.ai ? opp.user : `@${opp.user}`));
        nav('live', true);
      }} />;
      break;
    case 'live':
      body = match ? <LiveScreen match={match} opp={opp} onResult={() => nav('result', true)} /> : null;
      break;
    case 'result':
      body = match ? <ResultScreen match={match} opp={opp} ranked={mode === 'ranked'} onHome={() => nav('home')}
        onRematch={() => { setMatch(null); nav(mode === 'ranked' ? 'matchmaking' : 'vs', true); }} /> : null;
      break;
  }
  // Live and result need a match; after a reload mid-flow, fall back to Home.
  if (body === null) body = <HomeScreen inboxCount={inboxCount} go={(to) => (to === 'ai' ? startBattle('ai', AI_OPP) : nav(to))} />;

  return (
    <div className="vb vb-screen" style={{ position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div key={screen} style={{ flex: 1, minHeight: 0, position: 'relative', animation: 'vfade .2s ease' }}>{body}</div>
      {screen === 'home' && banner === 'shown' && (
        <InviteBanner onOpen={() => setBanner('modal')} onDismiss={() => setBanner('done')} />
      )}
      {banner === 'modal' && <InviteModal onAccept={acceptInvite} onDecline={declineInvite} />}
    </div>
  );
}
