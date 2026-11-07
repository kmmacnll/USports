'use client';

import { C, FB, OPP_TEAM, full, uniName, type FbPos } from './data';
import { useStore } from './store';
import { Chip, ChipRow, Icon, List, UniMark, num } from './ui';

const POS: ('All' | FbPos)[] = ['All', 'QB', 'RB', 'WR', 'K', 'LB', 'DB'];

export function PlayersScreen() {
  const { st, set, owner, addPlayer, toast } = useStore();
  const ql = st.q.trim().toLowerCase();
  const rows = FB
    .filter((a) => (st.pos === 'All' || a.pos === st.pos)
      && (!ql || `${a.first} ${a.last} ${uniName(a.uni)}`.toLowerCase().includes(ql))
      && (!st.availOnly || owner(a.id) === 'fa'))
    .sort((a, b) => b.fpg - a.fpg);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'vhq-up .3s ease' }}>
      <div style={{ padding: '8px 20px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>Players</h1>
        <span style={{ fontSize: 12, color: C.dim }}>OUA Diehards · Football</span>
      </div>
      <label style={{ margin: '0 16px', height: 44, borderRadius: 12, background: C.surface, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <Icon name="search" size={20} color={C.dim} />
        <input type="search" aria-label="Search players" value={st.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name or university"
          className="vhq-input" style={{ flex: 1, fontSize: 15 }} />
      </label>
      <ChipRow label="Position">
        {POS.map((p) => <Chip key={p} on={st.pos === p} onClick={() => set({ pos: p })}>{p}</Chip>)}
      </ChipRow>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
        <button type="button" role="switch" aria-checked={st.availOnly} onClick={() => set((s) => ({ availOnly: !s.availOnly }))}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: C.text2, height: 36 }}>
          <Icon name={st.availOnly ? 'toggle_on' : 'toggle_off'} size={22} fill color={st.availOnly ? C.primary : C.dim} />Free agents only
        </button>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: C.dim }}>FP/G · TOTAL</span>
      </div>
      <List>
        {rows.map((a) => {
          const o = owner(a.id);
          const ownerText = o === 'mine' ? 'Your team' : o === 'opp' ? OPP_TEAM : 'Free agent';
          const action = o === 'fa'
            ? { icon: 'add', bg: 'rgba(76,195,138,.14)', fg: C.green, label: `Add ${full(a)}`, run: () => addPlayer(a.id) }
            : o === 'mine'
              ? { icon: 'check', bg: C.surface2, fg: C.primary, label: `${full(a)} is on your team`, run: () => set({ sheet: { type: 'player', id: a.id } }) }
              : { icon: 'swap_horiz', bg: C.surface2, fg: C.dim, label: `Trade for ${full(a)}`, run: () => toast('Trade offers are coming soon') };
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px 8px 14px', minHeight: 62 }}>
              <button type="button" onClick={() => set({ sheet: { type: 'player', id: a.id } })} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                <UniMark uni={a.uni} size={36} radius={10} font={12} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="vhq-ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{full(a)}</span>
                  <span className="vhq-ellipsis" style={{ fontSize: 11.5, color: C.dim }}>
                    {a.pos} · {uniName(a.uni)} · <span style={{ color: o === 'mine' ? C.primary : o === 'fa' ? C.green : C.dim }}>{ownerText}</span>
                  </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={num(18, C.blue, 600, 1.1)}>{a.fpg.toFixed(1)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.dim }}>{(a.fpg * a.gp).toFixed(1)}</span>
                </span>
              </button>
              <button type="button" aria-label={action.label} onClick={action.run}
                style={{ width: 44, height: 44, flex: 'none', borderRadius: 22, display: 'grid', placeItems: 'center', background: action.bg }}>
                <Icon name={action.icon} size={22} color={action.fg} />
              </button>
            </div>
          );
        })}
        {!rows.length && <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: C.dim }}>No players match.</div>}
      </List>
    </div>
  );
}
