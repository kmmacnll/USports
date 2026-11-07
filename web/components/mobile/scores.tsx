'use client';

import { C, DAYS, GAMES, SPORTS, STARTERS, fb, sportName, uniName, type Game } from './data';
import { useStore } from './store';
import { Chip, ChipRow, Dot, List, UniMark, num } from './ui';

export function ScoresScreen() {
  const { st, set } = useStore();
  const myUnis = new Set(st.slots.slice(0, STARTERS).filter((x): x is string => !!x).map((id) => fb(id).uni));
  const list = st.scoreSport === 'usports_fb' ? GAMES[st.day] : [];
  const groups = ([['Live', 'live'], ['Upcoming', 'up'], ['Final', 'fin']] as const)
    .map(([title, k]) => ({ title, games: list.filter((g) => g.state === k) }))
    .filter((x) => x.games.length);

  const side = (abbr: string, sc: number | null, other: number | null, g: Game) => {
    const fin = g.state === 'fin';
    const lost = fin && sc !== null && other !== null && sc < other;
    const won = fin && sc !== null && other !== null && sc > other;
    const color = lost ? C.muted : C.text;
    return (
      <div key={abbr} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <UniMark uni={abbr} size={26} radius={7} font={10} spacing=".02em" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: won ? 800 : 600, color }}>{uniName(abbr)}</span>
        <Dot color={myUnis.has(abbr) ? C.primary : 'transparent'} />
        <span style={{ width: 28, textAlign: 'right', ...num(19, color) }}>{sc ?? ''}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'vhq-up .3s ease' }}>
      <div style={{ padding: '8px 20px 0' }}><h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>Scores</h1></div>
      <ChipRow label="Sport">
        {SPORTS.map(([id, , code]) => <Chip key={id} on={st.scoreSport === id} onClick={() => set({ scoreSport: id })}>{code === 'FB' ? 'Football' : code}</Chip>)}
      </ChipRow>
      <div role="tablist" aria-label="Day" style={{ margin: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {DAYS.map(([dow, label, k]) => {
          const on = st.day === k;
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => set({ day: k })}
              style={{ height: 50, borderRadius: 12, background: on ? C.raised : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: on ? C.primary : C.faint }}>{dow}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: on ? C.text : C.dim }}>{label}</span>
            </button>
          );
        })}
      </div>
      {groups.map((grp) => (
        <section key={grp.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="vhq-kicker" style={{ padding: '0 20px', fontSize: 12 }}>{grp.title}</h2>
          <List>
            {grp.games.map((g) => {
              const live = g.state === 'live', fin = g.state === 'fin';
              return (
                <div key={g.home + g.away} style={{ display: 'grid', gridTemplateColumns: '1fr 78px', alignItems: 'center', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {side(g.home, g.hs, g.as, g)}
                    {side(g.away, g.as, g.hs, g)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, borderLeft: '1px solid rgba(255,255,255,.06)', height: '100%', justifyContent: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: live ? C.green : fin ? C.muted : C.text }}>{fin ? 'Final' : g.clock}</span>
                    <span style={{ fontSize: 10.5, color: C.dim }}>{live ? 'Live' : fin ? '' : 'Kickoff'}</span>
                  </div>
                </div>
              );
            })}
          </List>
        </section>
      ))}
      {!groups.length && (
        <div style={{ margin: '0 16px', padding: '40px 20px', borderRadius: 20, background: C.surface, textAlign: 'center', fontSize: 13, color: C.dim }}>
          {st.scoreSport === 'usports_fb' ? 'No games on this day' : `No ${sportName(st.scoreSport)} games on this day`}
        </div>
      )}
      <p style={{ margin: '0 28px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.dim }}>
        <Dot color={C.primary} />Your starters play in this game
      </p>
    </div>
  );
}
