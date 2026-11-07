'use client';

import { BB, C, DT, DTEAMS, ME_DRAFT, ROUNDS, bb, full, pickLabel, short, teamFor } from './data';
import { useStore, type Draft, type DraftView } from './store';
import { Chip, Icon, PrimaryButton, Segmented, UniMark, num } from './ui';

export function DraftRoom() {
  const { st, set, pick, toast, closeDraft } = useStore();
  const d = st.draft, n = d.picks.length, total = DT * ROUNDS;
  const done = n >= total, myTurn = !done && teamFor(n) === ME_DRAFT;
  let until = 0;
  if (!done && !myTurn) for (let k = n; k < total && teamFor(k) !== ME_DRAFT; k++) until++;
  const rd = Math.floor(Math.min(n, total - 1) / DT);
  const mineIds = d.picks.filter((_, i) => teamFor(i) === ME_DRAFT);
  const queued = d.queue.filter((id) => !d.picks.includes(id));
  const setD = (o: Partial<Draft>) => set((s) => ({ draft: { ...s.draft, ...o } }));

  const pool = d.view === 'queue' ? queued.map(bb)
    : d.view === 'team' ? mineIds.map(bb)
      : BB.filter((b) => !d.picks.includes(b.id) && (d.pos === 'All' || b.pos === d.pos));

  return (
    <div role="dialog" aria-modal="true" aria-label="Draft room" style={{ position: 'absolute', inset: 0, background: C.bg, zIndex: 30, display: 'flex', flexDirection: 'column', animation: 'vhq-sheet .35s cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}>
        <button type="button" aria-label="Close draft room" onClick={() => closeDraft()} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center' }}>
          <Icon name="close" size={24} color={C.muted} />
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ fontSize: 16, fontWeight: 800 }}>Snow Bowl Hoops</h1>
          <span style={{ fontSize: 11.5, color: C.dim }}>Men&apos;s Basketball · Snake · 10 teams · Round {rd + 1} of {ROUNDS}</span>
        </div>
      </div>

      <div aria-live="polite" style={{ margin: '0 16px', padding: '14px 16px', borderRadius: 18, background: myTurn ? C.primary : C.surface, color: myTurn ? C.ink : C.text, display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'background .3s' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.75 }}>{myTurn ? 'You’re on the clock' : 'On the clock'}</span>
          <span style={{ fontSize: 17, fontWeight: 800 }}>{myTurn ? 'Make your pick' : DTEAMS[teamFor(Math.min(n, total - 1))]}</span>
        </div>
        <span style={num(40, undefined, 600, 1)}>{myTurn ? `0:${String(d.clock).padStart(2, '0')}` : until ? `In ${until}` : '—'}</span>
      </div>

      <div className="vhq-noscroll" style={{ display: 'flex', gap: 6, padding: '12px 16px', overflowX: 'auto', flex: 'none' }}>
        {Array.from({ length: DT }, (_, k) => {
          const i = rd * DT + k, t = teamFor(i), pid = d.picks[i], cur = i === n, mine = t === ME_DRAFT;
          return (
            <div key={i} style={{ flex: 'none', width: 86, height: 58, borderRadius: 12, padding: '7px 9px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              background: cur ? (mine ? 'rgba(217,58,64,.16)' : C.raised) : C.surface,
              boxShadow: cur ? `0 0 0 1.5px ${mine ? C.primary : C.faint}` : mine ? 'inset 0 0 0 1px rgba(217,58,64,.35)' : 'none' }}>
              <span style={{ ...num(11, mine ? C.primary : C.dim), letterSpacing: '.04em' }}>{pickLabel(i)}</span>
              <span className="vhq-ellipsis" style={{ fontSize: 11, fontWeight: 700, color: pid ? C.text : C.dim }}>{pid ? short(bb(pid)) : DTEAMS[t]}</span>
            </div>
          );
        })}
      </div>

      {done ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 16px 40px', animation: 'vhq-up .3s ease' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>Draft complete</h2>
          <div className="vhq-list" style={{ display: 'flex', flexDirection: 'column', borderRadius: 18, background: C.surface, overflow: 'hidden' }}>
            {mineIds.map((id) => {
              const b = bb(id);
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                  <span style={{ ...num(13, C.primary), width: 34 }}>{pickLabel(d.picks.indexOf(id))}</span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{full(b)}</span>
                  <span style={{ fontSize: 12, color: C.dim }}>{b.pos} · {b.uni}</span>
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <PrimaryButton onClick={() => { closeDraft({ hoopsDrafted: true }); toast('Draft complete. Season starts Nov 13'); }}>Done</PrimaryButton>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Segmented<DraftView> label="Draft view" value={d.view} onChange={(k) => setD({ view: k })} height={34} style={{ margin: '0 16px 10px' }}
            items={[['players', 'Players'], ['queue', `Queue · ${queued.length}`], ['team', `My team · ${mineIds.length}`]]} />
          {d.view === 'players' && (
            <div role="group" aria-label="Position" style={{ display: 'flex', gap: 6, padding: '0 16px 10px' }}>
              {(['All', 'G', 'F', 'C'] as const).map((p) => <Chip key={p} on={d.pos === p} onClick={() => setD({ pos: p })} height={30} pad={13} font={12}>{p}</Chip>)}
            </div>
          )}
          <div className="vhq-noscroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 16px 30px' }}>
            <div className="vhq-list" style={{ display: 'flex', flexDirection: 'column', borderRadius: 18, background: C.surface, overflow: 'hidden' }}>
              {pool.map((b) => {
                const q = d.queue.includes(b.id), owned = d.view === 'team';
                return (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 12px', minHeight: 60, animation: 'vhq-fade .25s ease' }}>
                    <UniMark uni={b.uni} size={34} radius={10} font={11} spacing="normal" />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="vhq-ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{full(b)}</span>
                      <span className="vhq-ellipsis" style={{ fontSize: 11, color: C.dim }}>{b.pos} · {b.ppg} / {b.rpg} / {b.apg} <span style={{ color: C.faint }}>PTS/REB/AST</span></span>
                    </div>
                    <span style={{ ...num(17, C.blue), width: 34, textAlign: 'right' }}>{b.fpg.toFixed(1)}</span>
                    <button type="button" aria-label={q ? `Remove ${full(b)} from queue` : `Queue ${full(b)}`} aria-pressed={q}
                      onClick={() => setD({ queue: q ? d.queue.filter((x) => x !== b.id) : [...d.queue, b.id] })}
                      style={{ width: 36, height: 44, display: 'grid', placeItems: 'center' }}>
                      <Icon name="star" size={21} fill={q} color={q ? C.primary : C.faint} />
                    </button>
                    <button type="button" aria-disabled={owned || !myTurn}
                      onClick={() => {
                        if (owned) return;
                        if (myTurn) { pick(b.id); toast(`You drafted ${short(b)}`); }
                        else toast(until === 0 ? 'Waiting for pick…' : `Your pick is in ${until} ${until === 1 ? 'pick' : 'picks'}`);
                      }}
                      style={{ height: 34, padding: '0 13px', borderRadius: 17, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center',
                        background: !owned && myTurn ? C.primary : C.surface2, color: owned ? C.primary : myTurn ? C.ink : C.faint }}>
                      {owned ? 'Yours' : 'Draft'}
                    </button>
                  </div>
                );
              })}
              {!pool.length && (
                <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: C.dim }}>
                  {d.view === 'queue' ? 'Star players to queue them. Your top queued player is auto-picked if the clock runs out.' : 'No picks yet'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
