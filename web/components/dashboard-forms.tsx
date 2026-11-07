'use client';

import { Check, Info, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { useActionState, useState } from 'react';

import { acceptTerms, createLeague, joinLeague } from '@/lib/actions';
import type { Sport } from '@/lib/types';

import { Segmented, Sheet } from './sheet';
import { ErrorNote } from './ui';

const choice = (on: boolean) =>
  `h-14 rounded-2xl text-[15px] font-extrabold transition ${on ? 'bg-primary/15 text-ink ring-2 ring-primary' : 'bg-surface-2/80 text-ink-2 ring-1 ring-blue/15'}`;
const pill = (on: boolean, locked = false) =>
  `inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition ${locked ? 'bg-bg text-ink-4 line-through decoration-ink-4/50' : on ? 'bg-primary text-white' : 'bg-surface-2 text-ink-2 ring-1 ring-blue/15'}`;

/** First-run eligibility + terms (the design's onboarding screen, inline on Home). */
export function TermsForm({ version, sports }: { version: string; sports: Sport[] }) {
  const [state, action, pending] = useActionState(acceptTerms, null);
  const [athlete, setAthlete] = useState<boolean | null>(null);
  const [mine, setMine] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const ready = athlete !== null && accepted && (!athlete || mine.length > 0);
  const names = sports.filter((s) => mine.includes(s.sport_id)).map((s) => s.sport_name);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="terms_version" value={version} />
      <input type="hidden" name="is_usports_athlete" value={athlete ? 'yes' : 'no'} />
      {athlete && mine.map((id) => <input key={id} type="hidden" name="athlete_sports" value={id} />)}
      <div className="space-y-1.5">
        <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-primary-text">Before your first league</p>
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">Are you a current U Sports student-athlete?</h2>
        <p className="text-[13.5px] leading-relaxed text-ink-3">Athletes can play fantasy in every sport except the ones they compete in.</p>
      </div>
      <div role="radiogroup" aria-label="Student-athlete" className="grid grid-cols-2 gap-2.5">
        <button type="button" role="radio" aria-checked={athlete === false} className={choice(athlete === false)} onClick={() => { setAthlete(false); setMine([]); }}>No</button>
        <button type="button" role="radio" aria-checked={athlete === true} className={choice(athlete === true)} onClick={() => setAthlete(true)}>Yes, I am</button>
      </div>
      {athlete && (
        <div className="enter space-y-3">
          <p className="text-sm font-bold">Which varsity rosters are you on?</p>
          <div className="flex flex-wrap gap-2">
            {sports.map((s) => {
              const on = mine.includes(s.sport_id);
              return (
                <button key={s.sport_id} type="button" aria-pressed={on} className={pill(on)}
                  onClick={() => setMine((m) => (on ? m.filter((x) => x !== s.sport_id) : [...m, s.sport_id]))}>
                  {s.sport_name}
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className="flex gap-2.5 rounded-2xl bg-bg/60 px-3.5 py-3 text-[13px] leading-snug text-ink-3">
            <Info className="mt-px size-[18px] flex-none text-primary-text" />
            {names.length ? `You won’t be able to join or create leagues in ${names.join(', ')}. Every other sport stays open.` : 'Select each sport you’re on a varsity roster for.'}
          </p>
        </div>
      )}
      <button type="button" role="checkbox" aria-checked={accepted} onClick={() => setAccepted((a) => !a)}
        className="flex items-start gap-3 text-left text-[13px] leading-snug text-ink-3">
        <span className={`mt-px grid size-[22px] flex-none place-items-center rounded-md transition ${accepted ? 'bg-primary text-white' : 'ring-2 ring-ink-4/60'}`}>
          {accepted && <Check className="size-4" strokeWidth={3} />}
        </span>
        I accept the Terms &amp; Conditions, including the Athlete Eligibility section ({version}).
      </button>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary h-[52px] w-full text-base" disabled={pending || !ready}><ShieldCheck className="size-5" /> Continue</button>
    </form>
  );
}

function CreateLeagueForm({ sports, defaultSport, blocked }: { sports: Sport[]; defaultSport?: string; blocked: string[] }) {
  const [state, action, pending] = useActionState(createLeague, null);
  const usable = sports.filter((s) => s.ruleset_id);
  const firstOpen = usable.find((s) => !blocked.includes(s.sport_id))?.sport_id;
  const [sport, setSport] = useState(defaultSport && !blocked.includes(defaultSport) && usable.some((s) => s.sport_id === defaultSport) ? defaultSport : firstOpen ?? '');
  const [teams, setTeams] = useState(10);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sport" value={sport} />
      <input type="hidden" name="max_teams" value={teams} />
      <div>
        <label className="label" htmlFor="league_name">League name</label>
        <input id="league_name" name="league_name" required maxLength={80} className="input" placeholder="e.g. Residence Rivals" />
      </div>
      <div role="radiogroup" aria-labelledby="sport-label">
        <span id="sport-label" className="label">Sport</span>
        <div className="flex flex-wrap gap-1.5">
          {usable.map((s) => {
            const locked = blocked.includes(s.sport_id);
            return (
              <button key={s.sport_id} type="button" role="radio" aria-checked={sport === s.sport_id} aria-disabled={locked}
                title={locked ? 'You compete in this sport' : undefined}
                className={pill(sport === s.sport_id, locked)} onClick={() => !locked && setSport(s.sport_id)}>
                {s.sport_name}
              </button>
            );
          })}
        </div>
        {blocked.length > 0 && <p className="mt-2 text-xs text-ink-4">Crossed-out sports are ones you compete in.</p>}
      </div>
      <div className="flex items-center justify-between">
        <span id="teams-label" className="text-sm font-bold">Teams</span>
        <div role="radiogroup" aria-labelledby="teams-label" className="flex gap-1.5">
          {[6, 8, 10, 12].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={teams === n} onClick={() => setTeams(n)}
              className={`num h-10 w-12 rounded-xl text-lg transition ${teams === n ? 'bg-ink text-bg' : 'bg-surface-2 text-ink-2 ring-1 ring-blue/15'}`}>{n}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="team_name">Your team name</label>
        <input id="team_name" name="team_name" required maxLength={60} className="input" placeholder="Commish FC" />
      </div>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary h-[52px] w-full text-[15px]" disabled={pending || !sport}><Plus className="size-5" /> {pending ? 'Creating…' : 'Create league'}</button>
    </form>
  );
}

function JoinLeagueForm() {
  const [state, action, pending] = useActionState(joinLeague, null);
  return (
    <form action={action} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="league_id">League ID</label>
          <input id="league_id" name="league_id" required className="input" placeholder="lg_12" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </div>
        <div>
          <label className="label" htmlFor="invite_code">Invite code</label>
          <input id="invite_code" name="invite_code" className="input font-mono" placeholder="3f9a1c2e" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </div>
      </div>
      <p className="-mt-2 text-xs text-ink-4">Your commissioner can copy both from the league page.</p>
      <div>
        <label className="label" htmlFor="join_team_name">Your team name</label>
        <input id="join_team_name" name="team_name" required maxLength={60} className="input" />
      </div>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary h-[52px] w-full text-[15px]" disabled={pending}><UserPlus className="size-5" /> {pending ? 'Joining…' : 'Join league'}</button>
    </form>
  );
}

type Mode = 'create' | 'join';

/** "+" and "Join with code" both open this sheet. */
export function LeagueSheetButton({ sports, defaultSport, blocked, mode: initial, className, children, label }: {
  sports: Sport[]; defaultSport?: string; blocked: string[]; mode: Mode; className: string; children: React.ReactNode; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(initial);
  return (
    <>
      <button type="button" className={className} aria-label={label} onClick={() => { setMode(initial); setOpen(true); }}>{children}</button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Create or join a league">
        <div className="space-y-5 pt-1">
          <Segmented label="Create or join" value={mode} onChange={setMode} items={[['create', 'Create'], ['join', 'Join']]} className="sm:mr-10" />
          {mode === 'create' ? <CreateLeagueForm sports={sports} defaultSport={defaultSport} blocked={blocked} /> : <JoinLeagueForm />}
        </div>
      </Sheet>
    </>
  );
}
