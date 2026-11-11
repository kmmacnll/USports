'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { updateProfile } from '@/lib/actions';

import { useMe } from './me';
import { DISPLAY, Icon, TopBar } from './ui';

const AVATAR_PX = 160;

/** Crop an uploaded image to a centred square and shrink it to a small JPEG data URL. */
async function toAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_PX;
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const field: React.CSSProperties = {
  height: 48, borderRadius: 14, padding: '0 14px', fontSize: 15, fontWeight: 700, color: '#F2F4F8',
  background: '#0D1526', border: '1px solid rgba(142,177,245,.22)', outline: 'none', width: '100%',
};

/** Profile settings: display name and profile picture. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const me = useMe();
  const router = useRouter();
  const [name, setName] = useState(me.signedIn ? me.name : '');
  const [avatar, setAvatar] = useState<string | null>(me.avatar);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const dirty = name.trim() !== me.name || avatar !== me.avatar;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setMsg({ ok: false, text: 'Choose an image file.' }); return; }
    try { setAvatar(await toAvatar(f)); setMsg(null); } catch { setMsg({ ok: false, text: 'That image could not be read.' }); }
  };

  const save = () => start(async () => {
    const res = await updateProfile({
      display_name: name.trim() !== me.name ? name.trim() : undefined,
      avatar_data_url: avatar !== me.avatar ? avatar : undefined,
    });
    if (res.ok) { setMsg({ ok: true, text: 'Saved' }); router.refresh(); } else setMsg({ ok: false, text: res.error.message });
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar title="Settings" onBack={onBack} />
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => file.current?.click()} aria-label="Change profile picture"
            style={{ width: 112, height: 112, borderRadius: '50%', padding: 3, background: 'linear-gradient(160deg,#E5484D,#8EB1F5)', position: 'relative' }}>
            <span style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 35% 30%,#2F5596,#0C1628 75%)', font: `italic 900 40px ${DISPLAY}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : me.ini}
            </span>
            <span style={{ position: 'absolute', right: 2, bottom: 2, width: 34, height: 34, borderRadius: 17, background: '#18233A', border: '2px solid #05080F', display: 'grid', placeItems: 'center' }}>
              <Icon name="photo_camera" size={18} />
            </span>
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => file.current?.click()} className="vb-tile vb-press" style={{ height: 38, padding: '0 14px', borderRadius: 12, fontSize: 13, fontWeight: 800 }}>Upload photo</button>
            {avatar && <button type="button" onClick={() => setAvatar(null)} className="vb-tile vb-press" style={{ height: 38, padding: '0 14px', borderRadius: 12, fontSize: 13, fontWeight: 800, color: '#93A0B8' }}>Remove</button>}
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: '#93A0B8' }}>DISPLAY NAME</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" style={field} />
        </label>

        <button type="button" onClick={save} disabled={!dirty || !name.trim() || saving} className="vb-btn-primary vb-press"
          style={{ height: 50, borderRadius: 16, fontSize: 15, fontWeight: 800, opacity: !dirty || !name.trim() || saving ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {msg && <span role="status" style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: msg.ok ? '#3DD68C' : '#FF6B6B' }}>{msg.text}</span>}
      </div>
    </div>
  );
}
