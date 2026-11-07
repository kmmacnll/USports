'use client';

import { C, SPORTS, sportName } from './data';
import { useStore } from './store';
import { Icon, PrimaryButton } from './ui';

export function Welcome() {
  const { set } = useStore();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'vhq-fade .35s ease' }}>
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(70% 55% at 50% 48%,rgba(38,70,128,.45),rgba(10,15,26,0) 70%)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mobile/varsityhq-logo-dark.png" alt="VarsityHQ" style={{ width: 220, height: 'auto', filter: 'drop-shadow(0 18px 40px rgba(0,0,0,.5))' }} />
      </div>
      <div style={{ position: 'relative', padding: '0 24px 44px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h1 style={{ fontSize: 31, lineHeight: 1.12, fontWeight: 800, letterSpacing: '-.025em', textWrap: 'pretty' }}>
          Draft real Canadian university athletes. Score with real box scores.
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={() => set({ stage: 'elig' })}>Get started</PrimaryButton>
          <PrimaryButton onClick={() => set({ stage: 'elig' })} bg={C.surface2} fg={C.text} style={{ fontWeight: 700 }}>I have an account</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export function Eligibility() {
  const { st, set, toast, go } = useStore();
  const ready = st.isAthlete !== null && st.accepted && (!st.isAthlete || st.athSports.length > 0);
  const choice = (on: boolean) => ({ background: on ? 'rgba(217,58,64,.12)' : C.surface, boxShadow: on ? `inset 0 0 0 2px ${C.primary}` : 'none' });
  const choiceBtn = { height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700, fontSize: 15 } as const;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'vhq-up .3s ease' }}>
      <div style={{ padding: '6px 12px 0', display: 'flex', alignItems: 'center' }}>
        <button type="button" aria-label="Back" onClick={() => set({ stage: 'welcome' })} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center' }}>
          <Icon name="arrow_back_ios_new" size={24} color={C.muted} />
        </button>
      </div>
      <div className="vhq-noscroll" style={{ flex: 1, overflow: 'auto', padding: '4px 24px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.primary }}>Before your first league</span>
          <h1 style={{ fontSize: 26, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-.02em' }}>Are you a current U Sports student-athlete?</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: C.muted, textWrap: 'pretty' }}>Athletes can play fantasy in every sport except the ones they compete in.</p>
        </div>
        <div role="radiogroup" aria-label="Student-athlete" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button type="button" role="radio" aria-checked={st.isAthlete === false} onClick={() => set({ isAthlete: false, athSports: [] })} style={{ ...choiceBtn, ...choice(st.isAthlete === false) }}>No</button>
          <button type="button" role="radio" aria-checked={st.isAthlete === true} onClick={() => set({ isAthlete: true })} style={{ ...choiceBtn, ...choice(st.isAthlete === true) }}>Yes, I am</button>
        </div>
        {st.isAthlete && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'vhq-up .25s ease' }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Which varsity rosters are you on?</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SPORTS.map(([id, name]) => {
                const on = st.athSports.includes(id);
                return (
                  <button key={id} type="button" aria-pressed={on}
                    onClick={() => set((s) => ({ athSports: on ? s.athSports.filter((x) => x !== id) : [...s.athSports, id] }))}
                    style={{ height: 40, padding: '0 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: on ? C.primary : C.surface2, color: on ? C.ink : C.text2, display: 'flex', alignItems: 'center' }}>
                    {name}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 14, background: C.surface, fontSize: 13, lineHeight: 1.45, color: C.muted }}>
              <Icon name="info" size={20} color={C.primary} />
              <span aria-live="polite">
                {st.athSports.length
                  ? `You won’t be able to join or create leagues in ${st.athSports.map(sportName).join(', ')}. Every other sport stays open.`
                  : 'Select each sport you’re on a varsity roster for.'}
              </span>
            </div>
          </div>
        )}
        <button type="button" role="checkbox" aria-checked={st.accepted} onClick={() => set((s) => ({ accepted: !s.accepted }))}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 13, lineHeight: 1.45, color: C.muted }}>
          <Icon name={st.accepted ? 'check_box' : 'check_box_outline_blank'} size={24} fill color={st.accepted ? C.primary : C.dim} />
          <span>I accept the Terms &amp; Conditions, including the Athlete Eligibility section (v2026-11-01).</span>
        </button>
      </div>
      <div style={{ padding: '12px 24px 40px' }}>
        <PrimaryButton enabled={ready} onClick={() => { if (!ready) return; go('home'); toast('You’re all set'); }}>Continue</PrimaryButton>
      </div>
    </div>
  );
}
