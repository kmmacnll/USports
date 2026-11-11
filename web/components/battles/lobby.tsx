'use client';

import { SPORTS, type SportId } from './data';
import { Chip, Icon, PlayRandomButton, TopBar } from './ui';

export type Gender = 'M' | 'W';

export function LobbyScreen({ sport, gender, setSport, setGender, onBack, onAI, onFriend, poolSize }: {
  sport: SportId; gender: Gender; setSport: (s: SportId) => void; setGender: (g: Gender) => void;
  onBack: () => void; onAI: () => void; onFriend: () => void; poolSize: number;
}) {
  const cur = SPORTS.find((s) => s.id === sport)!;
  const hockey = sport === 'hockey';
  // A battle drafts 12 players (6 a side), so it needs at least that many rated athletes.
  const ready = hockey && poolSize >= 12;
  const line = !hockey ? `${cur.name} Draft Battles are coming soon. Hockey is live now.`
    : !ready ? `${gender === 'W' ? "Women's" : "Men's"} Hockey ratings for real U Sports athletes aren’t available yet. Check back soon.`
    : `${gender === 'W' ? "Women's" : "Men's"} ${cur.name} · ranked queues open soon. Play AI any time.`;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Battles" onBack={onBack} />
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 16px 0' }}>
        <span className="vb-label" id="sport-label">Choose a sport</span>
        <div role="radiogroup" aria-labelledby="sport-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
          {SPORTS.map((s, i) => {
            const on = s.id === sport;
            return (
              <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => setSport(s.id)}
                style={{ gridColumn: i < 3 ? 'span 2' : 'span 3', height: 104, borderRadius: 20, border: `1px solid ${on ? 'rgba(229,72,77,.7)' : 'rgba(142,177,245,.2)'}`,
                  background: on ? 'linear-gradient(160deg,rgba(150,36,50,.6),rgba(13,21,38,.92) 75%)' : 'linear-gradient(160deg,rgba(38,62,110,.6),rgba(13,21,38,.9) 70%)',
                  boxShadow: on ? 'inset 0 0 26px rgba(217,58,64,.28),0 0 22px rgba(217,58,64,.25)' : 'inset 0 1px 0 rgba(255,255,255,.06)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .2s', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg,rgba(255,255,255,.07),transparent 45%)' }} />
                <Icon name={s.icon} size={38} fill color={on ? '#F2666B' : '#93A0B8'} />
                <span style={{ fontSize: 13, fontWeight: 800, color: on ? '#F2F4F8' : '#C3CBDA' }}>{s.name}</span>
              </button>
            );
          })}
        </div>
        <div role="radiogroup" aria-label="Division" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 4, borderRadius: 16, background: '#0D1422', border: '1px solid rgba(142,177,245,.14)' }}>
          {([['M', "Men's"], ['W', "Women's"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={gender === k} onClick={() => setGender(k)}
              style={{ height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, background: gender === k ? '#263552' : 'transparent', color: gender === k ? '#F2F4F8' : '#93A0B8', transition: 'all .2s' }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 12, fontWeight: 700, color: '#93A0B8', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="style" size={16} />6 picks</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="grid_view" size={16} />{cur.formation}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="timer" size={16} />~3 min sim</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {([['smart_toy', 'Play AI', 'UNRANKED · INSTANT', onAI], ['group_add', 'Play a Friend', 'COMING SOON', onFriend]] as const).map(([icon, t, sub, fn]) => (
            <button key={t} type="button" onClick={fn} disabled={!ready} className="vb-tile vb-press"
              style={{ height: 116, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: 14, opacity: ready ? 1 : 0.5 }}>
              <Icon name={icon} size={30} fill color="#8EB1F5" />
              <span style={{ fontSize: 16, fontWeight: 800 }}>{t}</span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: '#93A0B8' }}>{sub}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 'none', padding: '12px 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#93A0B8' }} aria-live="polite">{line}</span>
        <PlayRandomButton onClick={() => {}} disabled sub="RANKED · COMING SOON" />
      </div>
    </div>
  );
}

// ---------- Coming-soon screens (need real users from the API) ----------
function ComingSoon({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 28px 60px', textAlign: 'center' }}>
      <div className="vb-tile" style={{ width: 96, height: 96, display: 'grid', placeItems: 'center' }}><Icon name={icon} size={42} color="#8EB1F5" /></div>
      <span style={{ fontSize: 20, fontWeight: 800 }}>{title}</span>
      {body && <span style={{ fontSize: 13, lineHeight: 1.5, color: '#93A0B8' }}>{body}</span>}
      {action}
    </div>
  );
}

const PlayAIButton = ({ onClick, label = 'Play AI instead' }: { onClick: () => void; label?: string }) => (
  <button type="button" onClick={onClick} className="vb-btn-primary vb-press" style={{ marginTop: 8, height: 48, padding: '0 20px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}>
    <Icon name="smart_toy" size={19} />{label}
  </button>
);

export function FriendsScreen({ onBack, onAI }: { onBack: () => void; onAI: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Play a Friend" onBack={onBack} right={<Chip tone="muted" style={{ fontSize: 10.5 }}>UNRANKED</Chip>} />
      <ComingSoon icon="group_add" title="No friends yet"
        action={<>
          {/* Not wired up yet: friends need an API. */}
          <button type="button" className="vb-tile vb-press" style={{ marginTop: 8, height: 48, padding: '0 20px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}>
            <Icon name="person_add" size={19} />Add friends
          </button>
          <PlayAIButton onClick={onAI} />
        </>} />
    </div>
  );
}
