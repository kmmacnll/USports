'use client';

import { C, OPP, OPP_TEAM, ME_TEAM, SLOTS, STARTERS, fb, full, gs, short, slotLabel } from './data';
import { WinBar } from './home';
import { useStore, type Seg } from './store';
import { Dot, Icon, List, Segmented, num } from './ui';

export function LeagueScreen() {
  const { st, go } = useStore();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', animation: 'vhq-up .3s ease' }}>
      <div style={{ padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>OUA Diehards</h1>
          <Icon name="expand_more" size={22} color={C.dim} />
        </div>
        <span style={{ fontSize: 12, color: C.muted }}>Football · 10 teams · 2026-27 · Season points</span>
      </div>
      <Segmented<Seg> label="League view" value={st.seg} onChange={(k) => go(k)} style={{ margin: '0 16px 14px' }}
        items={[['matchup', 'Matchup'], ['standings', 'Standings'], ['roster', 'Roster']]} />
      {st.seg === 'matchup' && <Matchup />}
      {st.seg === 'standings' && <Standings />}
      {st.seg === 'roster' && <Roster />}
    </div>
  );
}

function Matchup() {
  const { st, set, matchup: m } = useStore();
  const starters = st.slots.slice(0, STARTERS);

  const side = (id: string | null, right = false, key: string) => {
    if (!id) {
      return (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: right ? '8px 12px 8px 6px' : '8px 6px 8px 12px', flexDirection: right ? 'row-reverse' : 'row', height: '100%' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, alignItems: right ? 'flex-end' : 'flex-start' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Empty</span>
            <span style={{ fontSize: 10.5, color: C.dim }}>—</span>
          </span>
          <span style={num(19, C.dim)}>—</span>
        </div>
      );
    }
    const a = fb(id), g = gs(a.uni);
    return (
      <button key={key} type="button" onClick={() => set({ sheet: { type: 'player', id } })} aria-label={`${full(a)}, ${st.live[id]!.toFixed(1)} points`}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: right ? '8px 12px 8px 6px' : '8px 6px 8px 12px', height: '100%', minWidth: 0, flexDirection: right ? 'row-reverse' : 'row', background: st.flash === id ? 'rgba(217,58,64,.18)' : 'transparent', transition: 'background .6s ease' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, alignItems: right ? 'flex-end' : 'flex-start', textAlign: right ? 'right' : 'left' }}>
          <span className="vhq-ellipsis" style={{ fontSize: 13, fontWeight: 700, maxWidth: '100%' }}>{short(a)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: C.dim, whiteSpace: 'nowrap', flexDirection: right ? 'row-reverse' : 'row' }}>
            <Dot color={g.live ? C.green : 'transparent'} size={5} />{a.uni} · {g.s}
          </span>
        </span>
        <span style={num(19, g.up ? C.dim : C.text)}>{st.live[id]!.toFixed(1)}</span>
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'vhq-fade .25s ease' }}>
      <div style={{ margin: '0 16px', padding: 16, borderRadius: 20, background: C.surface, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>You</span>
            <span style={num(40, m.my >= m.op ? C.text : C.muted, 600, 1)}>{m.my.toFixed(1)}</span>
            <span style={{ fontSize: 11, color: C.dim }}>Proj {m.myP.toFixed(1)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: C.green }}><Dot color={C.green} pulse />LIVE</span>
            <span style={{ fontSize: 11, color: C.dim }}>Today</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Priya S.</span>
            <span style={num(40, m.op > m.my ? C.text : C.muted, 600, 1)}>{m.op.toFixed(1)}</span>
            <span style={{ fontSize: 11, color: C.dim }}>Proj {m.opP.toFixed(1)}</span>
          </div>
        </div>
        <WinBar win={m.win} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: C.muted }}>
          <span>{ME_TEAM} · {(m.win * 100).toFixed(0)}%</span><span>{OPP_TEAM}</span>
        </div>
      </div>

      <List radius={16} style={{ background: '#0D1422', border: '1px solid rgba(255,255,255,.05)' }}>
        {st.feed.map((f) => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', animation: 'vhq-up .3s ease' }}>
              <Dot color={f.mine ? C.primary : C.muted} />
              <span className="vhq-ellipsis" style={{ flex: 1, fontSize: 12, color: C.text2 }}><b style={{ color: C.text }}>{f.who}</b> · {f.text}</span>
              <span style={num(15, f.mine ? C.primary : C.muted)}>{f.pts}</span>
            </div>
        ))}
      </List>

      <List>
        {SLOTS.slice(0, STARTERS).map((sl, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 40px minmax(0,1fr)', alignItems: 'center', minHeight: 58 }}>
            {side(starters[i] ?? null, false, 'l')}
            <span style={{ justifySelf: 'center', ...num(11, C.dim, 700), letterSpacing: '.06em' }}>{slotLabel(sl)}</span>
            {side(OPP[i] ?? null, true, 'r')}
          </div>
        ))}
      </List>
    </div>
  );
}

function Standings() {
  const { matchup: m } = useStore();
  const cols = '28px 1fr 62px 64px';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'vhq-fade .25s ease' }}>
      <div aria-hidden style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '0 30px 0 28px', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.dim }}>
        <span>#</span><span>Team</span><span style={{ textAlign: 'right' }}>Today</span><span style={{ textAlign: 'right' }}>Season</span>
      </div>
      <List>
        {m.standings.map((t) => (
          <div key={t.n} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '10px 14px 10px 12px', minHeight: 58, background: t.me ? 'rgba(217,58,64,.08)' : 'transparent', transition: 'background .3s' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={num(18, t.me ? C.primary : C.text, 600, 1)}>{t.rank}</span>
              <span style={{ fontSize: 9, fontWeight: 800, color: t.move > 0 ? C.green : t.move < 0 ? C.loss : C.faint }}>
                {t.move > 0 ? `▲${t.move}` : t.move < 0 ? `▼${-t.move}` : '–'}
              </span>
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span className="vhq-ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{t.n}</span>
              <span style={{ fontSize: 11, color: C.dim }}>{t.o}</span>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, ...num(15, C.text2) }}>
              <Dot color={t.live ? C.green : 'transparent'} size={5} />+{t.today.toFixed(1)}
            </span>
            <span style={{ textAlign: 'right', ...num(17) }}>{(t.base + t.today).toFixed(1)}</span>
          </div>
        ))}
      </List>
      <p style={{ margin: '4px 28px 0', fontSize: 11, lineHeight: 1.5, color: C.dim }}>Ranked by total roster points this season. Arrows show movement since the start of today.</p>
    </div>
  );
}

function Roster() {
  const { st, canMove, tapSlot } = useStore();
  const selA = st.sel !== null ? fb(st.slots[st.sel]!) : null;

  const card = (i: number) => {
    const id = st.slots[i], sel = st.sel === i, tgt = st.sel !== null && canMove(i), dim = st.sel !== null && !sel && !tgt;
    const a = id ? fb(id) : null, sl = SLOTS[i]!;
    return (
      <button key={i} type="button" onClick={() => tapSlot(i)} aria-pressed={sel}
        aria-label={`${slotLabel(sl)}: ${a ? full(a) : 'empty'}${tgt ? ', move here' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px 8px 8px', minHeight: 58, borderRadius: 14, background: C.surface, textAlign: 'left',
          boxShadow: sel ? `0 0 0 2px ${C.primary}` : tgt ? '0 0 0 1.5px rgba(217,58,64,.55)' : 'none', opacity: dim ? 0.38 : 1, transition: 'opacity .2s,box-shadow .2s' }}>
        <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 10, background: sl === 'BN' ? C.raised : 'rgba(217,58,64,.14)', color: sl === 'BN' ? C.muted : C.primary, display: 'grid', placeItems: 'center', ...num(13, undefined, 700), letterSpacing: '.04em' }}>{slotLabel(sl)}</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: a ? C.text : C.dim }}>{a ? full(a) : tgt ? 'Move here' : 'Empty'}</span>
          <span style={{ fontSize: 11.5, color: C.dim }}>{a ? `${a.uni} · ${a.pos} · ${gs(a.uni).s}` : 'Add from Players'}</span>
        </span>
        {a && (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={num(18, C.blue, 600, 1.1)}>{(a.fpg * a.gp).toFixed(1)}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.dim }}>{a.fpg.toFixed(1)} FP/G</span>
          </span>
        )}
      </button>
    );
  };

  const head = (t: string, n: string, pad: string) => (
    <h2 className="vhq-kicker" style={{ padding: pad, fontSize: 12 }}>
      {t} <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: C.dim }}>· {n}</span>
    </h2>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'vhq-fade .25s ease' }}>
      <div aria-live="polite" style={{ margin: '0 16px', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14, background: selA ? 'rgba(217,58,64,.12)' : C.surface, fontSize: 12, fontWeight: 600, color: selA ? C.primary : C.muted, transition: 'background .2s' }}>
        <Icon name="swap_vert" size={18} />
        <span style={{ flex: 1 }}>{selA ? `Move ${short(selA)}: tap a highlighted slot` : 'Tap a player, then tap a highlighted slot to swap'}</span>
      </div>
      {head('Starters', `${st.slots.slice(0, STARTERS).filter(Boolean).length}/10`, '0 20px')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 16px' }}>
        {Array.from({ length: STARTERS }, (_, i) => card(i))}
      </div>
      {head('Bench', `${st.slots.slice(STARTERS).filter(Boolean).length}/5`, '6px 20px 0')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 16px' }}>
        {Array.from({ length: SLOTS.length - STARTERS }, (_, k) => card(STARTERS + k))}
      </div>
    </div>
  );
}
