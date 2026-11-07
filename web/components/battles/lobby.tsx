'use client';

import { useState } from 'react';

import { avatarAt, avatarBg, FRIENDS, SPORTS, type Friend, type InboxItem, type SportId } from './data';
import { pad2, useElapsed, useTimeout } from './hooks';
import { BellButton, Chip, DivisionBadge, DISPLAY, Icon, PlayRandomButton, TopBar } from './ui';

export type Gender = 'M' | 'W';

export function LobbyScreen({ sport, gender, setSport, setGender, onBack, onInbox, inboxCount, onRandom, onAI, onFriend }: {
  sport: SportId; gender: Gender; setSport: (s: SportId) => void; setGender: (g: Gender) => void;
  onBack: () => void; onInbox: () => void; inboxCount: number; onRandom: () => void; onAI: () => void; onFriend: () => void;
}) {
  const cur = SPORTS.find((s) => s.id === sport)!;
  const ready = sport === 'hockey';
  const line = ready
    ? `${gender === 'W' ? "Women's" : "Men's"} ${cur.name} · Varsity II queue · avg wait 0:12`
    : `${cur.name} Draft Battles are coming soon. Hockey is live now.`;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Draft Battle" onBack={onBack} right={<BellButton count={inboxCount} onClick={onInbox} />} />
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
          {([['smart_toy', 'Play AI', 'UNRANKED · INSTANT', onAI], ['group_add', 'Play a Friend', 'UNRANKED · INVITE', onFriend]] as const).map(([icon, t, sub, fn]) => (
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
        <PlayRandomButton onClick={onRandom} disabled={!ready} sub={ready ? 'RANKED · VARSITY II · ±18 ELO' : 'COMING SOON'} />
      </div>
    </div>
  );
}

// ---------- Play a Friend ----------
function FriendRow({ f, pendingLeft, onInvite, onCancel }: { f: Friend; pendingLeft: number | undefined; onInvite: () => void; onCancel: () => void }) {
  const pend = pendingLeft !== undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 12px', borderRadius: 16, background: 'linear-gradient(90deg,rgba(28,42,70,.9),rgba(15,24,42,.9))', border: `1px solid ${pend ? 'rgba(255,138,61,.45)' : 'rgba(142,177,245,.14)'}` }}>
      <div style={{ position: 'relative', width: 42, height: 42, borderRadius: 21, background: avatarBg(f.tint), display: 'grid', placeItems: 'center', font: `italic 900 16px ${DISPLAY}`, flex: 'none' }}>
        {f.ini}
        <span aria-label={f.online ? 'Online' : 'Offline'} style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, background: f.online ? '#3DD68C' : '#4A5672', border: '2px solid #111A2A' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14.5, fontWeight: 800 }}>@{f.name}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#93A0B8' }}>{f.sub}</span>
      </div>
      {pend ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ height: 36, padding: '0 10px', borderRadius: 12, background: 'rgba(255,138,61,.14)', color: '#FF8A3D', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: '#FF8A3D', animation: 'vpulse 1.4s infinite' }} />Pending 0:{pad2(pendingLeft)}
          </span>
          <button type="button" onClick={onCancel} aria-label={`Cancel invite to ${f.name}`} style={{ width: 36, height: 36, borderRadius: 12, background: '#18233A', display: 'grid', placeItems: 'center', color: '#C3CBDA' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : f.busy ? (
        <span style={{ fontSize: 12, fontWeight: 800, color: '#93A0B8', paddingRight: 6 }}>In a battle</span>
      ) : (
        <button type="button" onClick={onInvite} className="vb-btn-primary" style={{ height: 36, padding: '0 14px', borderRadius: 12, fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center' }}>Invite</button>
      )}
    </div>
  );
}

export function FriendsScreen({ sportName, genderName, pending, invite, cancel, onBack }: {
  sportName: string; genderName: string; pending: Record<string, number>; invite: (name: string) => void; cancel: (name: string) => void; onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const fq = q.replace(/^@/, '').toLowerCase().trim();
  const rows = FRIENDS.filter((f) => !fq || f.name.includes(fq));
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Play a Friend" onBack={onBack} right={<Chip tone="muted" style={{ fontSize: 10.5 }}>UNRANKED</Chip>} />
      <div className="no-scrollbar" style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#C3CBDA' }}>
          <Icon name="sports_hockey" size={18} fill color="#F2666B" />{genderName} {sportName} Draft Battle
        </div>
        <label style={{ height: 50, borderRadius: 16, background: '#0D1422', border: '1px solid rgba(142,177,245,.25)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
          <Icon name="search" size={20} color="#93A0B8" />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#93A0B8' }}>@</span>
          <span className="sr-only">Search friends by username</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            style={{ all: 'unset', flex: 1, fontSize: 15, fontWeight: 600, color: '#F2F4F8' }} />
        </label>
        <span className="vb-label">{fq ? 'Results' : 'Friends'}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((f) => (
            <FriendRow key={f.name} f={f} pendingLeft={pending[f.name]} onInvite={() => invite(f.name)} onCancel={() => cancel(f.name)} />
          ))}
          {rows.length === 0 && (
            <div style={{ padding: '28px 16px', borderRadius: 16, background: '#0D1422', border: '1px dashed rgba(142,177,245,.25)', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 800 }}>No one called @{fq}</span>
              <span style={{ fontSize: 12, color: '#93A0B8' }}>Check the spelling, or share your invite link instead.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Inbox ----------
const CHIP: Record<InboxItem['chip'], { bg: string; fg: string }> = {
  PENDING: { bg: 'rgba(255,138,61,.16)', fg: '#FF8A3D' },
  ACCEPTED: { bg: 'rgba(61,214,140,.14)', fg: '#3DD68C' },
  DECLINED: { bg: 'rgba(142,177,245,.12)', fg: '#C3CBDA' },
  EXPIRED: { bg: 'rgba(142,177,245,.08)', fg: '#93A0B8' },
};

export function InboxScreen({ items, sent, onBack, onClear, onAccept, onDecline, onChallenge }: {
  items: InboxItem[]; sent: string[]; onBack: () => void; onClear: () => void; onAccept: (id: string) => void; onDecline: (id: string) => void; onChallenge: () => void;
}) {
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const pendingCount = items.filter((n) => n.chip === 'PENDING').length;
  const list = tab === 'received' ? items : sent.map((name, i): InboxItem => ({ id: `s-${name}`, title: `You challenged @${name}`, sub: "Hockey · Women's · Unranked", chip: 'PENDING', ini: name.slice(0, 2).toUpperCase(), tint: i + 6 }));
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Inbox" onBack={onBack} right={items.length > 0 && tab === 'received'
        ? <button type="button" onClick={onClear} style={{ fontSize: 13, fontWeight: 800, color: '#F2666B', padding: '10px 4px' }}>Clear</button> : undefined} />
      <div role="tablist" style={{ margin: '6px 16px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 4, borderRadius: 14, background: '#0D1422', border: '1px solid rgba(142,177,245,.14)', flex: 'none' }}>
        {([['received', `Received${pendingCount ? ` · ${pendingCount}` : ''}`], ['sent', `Sent${sent.length ? ` · ${sent.length}` : ''}`]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, background: tab === k ? '#263552' : 'transparent', color: tab === k ? '#F2F4F8' : '#93A0B8' }}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 28px 60px', textAlign: 'center' }}>
          <div className="vb-tile" style={{ width: 96, height: 96, display: 'grid', placeItems: 'center' }}><Icon name="inbox" size={42} color="#8EB1F5" /></div>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{tab === 'received' ? 'No invites yet' : 'No challenges sent'}</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: '#93A0B8' }}>{tab === 'received' ? 'When a friend challenges you, it shows up here and as a banner.' : 'Challenges you send to friends show up here until they answer.'}</span>
          <button type="button" onClick={onChallenge} className="vb-btn-primary vb-press" style={{ marginTop: 8, height: 48, padding: '0 20px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}>
            <Icon name="group_add" size={19} />Challenge a friend
          </button>
        </div>
      ) : (
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((n) => {
            const c = CHIP[n.chip];
            const actionable = tab === 'received' && n.chip === 'PENDING';
            return (
              <div key={n.id} style={{ padding: 12, borderRadius: 16, background: 'linear-gradient(90deg,rgba(28,42,70,.9),rgba(15,24,42,.9))', border: `1px solid ${actionable ? 'rgba(255,138,61,.45)' : n.chip === 'EXPIRED' ? 'rgba(142,177,245,.08)' : 'rgba(142,177,245,.14)'}`, display: 'flex', flexDirection: 'column', gap: 10, opacity: n.chip === 'EXPIRED' ? 0.6 : 1, flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: avatarAt(n.tint), display: 'grid', placeItems: 'center', font: `italic 900 15px ${DISPLAY}`, flex: 'none' }}>{n.ini}</div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800 }}>{n.title}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#93A0B8' }}>{n.sub}</span>
                  </div>
                  <span style={{ height: 24, padding: '0 9px', borderRadius: 12, background: c.bg, color: c.fg, fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{n.chip}</span>
                </div>
                {actionable && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button type="button" onClick={() => onDecline(n.id)} className="vb-btn vb-btn-ghost" style={{ height: 38, borderRadius: 12, fontSize: 13 }}>Decline</button>
                    <button type="button" onClick={() => onAccept(n.id)} className="vb-btn vb-btn-primary" style={{ height: 38, borderRadius: 12, fontSize: 13 }}>Accept</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Incoming invite: banner + modal ----------
export function InviteBanner({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div role="status" style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 50, borderRadius: 20, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(24,35,58,.96)', border: '1px solid rgba(255,138,61,.45)', boxShadow: '0 14px 30px rgba(0,0,0,.45),0 0 20px rgba(255,138,61,.18)', animation: 'vbanner .5s cubic-bezier(.2,.9,.25,1.1)' }}>
      <button type="button" onClick={onOpen} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 19, background: avatarBg('#3A7BD5'), display: 'grid', placeItems: 'center', font: `italic 900 15px ${DISPLAY}`, flex: 'none' }}>JB</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>@jaybird challenged you</span>
          <span style={{ fontSize: 11.5, color: '#C3CBDA' }}>Hockey · Women&apos;s · Unranked</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#93A0B8' }}>now</span>
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', color: '#93A0B8' }}><Icon name="close" size={18} /></button>
    </div>
  );
}

export function InviteModal({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const n = useElapsed();
  const left = Math.max(0, 60 - n);
  useTimeout(onDecline, 60_000); // invite expires
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(4,7,14,.7)', backdropFilter: 'blur(5px)', animation: 'vfade .25s ease' }} onClick={onDecline} />
      <div role="dialog" aria-modal="true" aria-labelledby="invite-title" className="vb-tile-primary"
        style={{ position: 'absolute', left: 20, right: 20, top: 140, background: 'linear-gradient(170deg,#3A1820,#0F1A2E 60%)', padding: '24px 20px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, animation: 'vup .45s ease' }}>
        <div style={{ position: 'relative', width: 118, height: 118 }}>
          <svg width="118" height="118" viewBox="0 0 118 118" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx="59" cy="59" r="54" fill="none" stroke="rgba(142,177,245,.15)" strokeWidth="6" />
            <circle cx="59" cy="59" r="54" fill="none" stroke="#FF8A3D" strokeWidth="6" strokeLinecap="round" strokeDasharray="339.3" strokeDashoffset={(339.3 * (1 - left / 60)).toFixed(1)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', background: avatarBg('#3A7BD5'), display: 'grid', placeItems: 'center', font: `italic 900 34px ${DISPLAY}` }}>JB</div>
          <span style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', height: 24, padding: '0 9px', borderRadius: 12, background: '#FF8A3D', color: '#1F0E02', font: `800 13px ${DISPLAY}`, display: 'flex', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }} aria-label={`${left} seconds left`}>{left}s</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
          <span id="invite-title" style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.3, textWrap: 'balance' }}>@jaybird challenged you to a Hockey Draft Battle</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#C3CBDA' }}><DivisionBadge tier="Varsity" size={18} />Varsity I · 1,531 · Women&apos;s · Unranked</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, width: '100%' }}>
          <button type="button" onClick={onDecline} className="vb-btn vb-btn-ghost" style={{ height: 52, fontSize: 15 }}>Decline</button>
          <button type="button" onClick={onAccept} autoFocus className="vb-btn vb-btn-primary vb-display" style={{ height: 52, fontSize: 22, letterSpacing: '.06em' }}>ACCEPT</button>
        </div>
      </div>
    </div>
  );
}
