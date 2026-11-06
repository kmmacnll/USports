'use client';

import { Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { useActionState, useState } from 'react';

import { acceptTerms, createLeague, joinLeague } from '@/lib/actions';
import type { Sport } from '@/lib/types';

import { ErrorNote } from './ui';

export function TermsForm({ version, sports }: { version: string; sports: Sport[] }) {
  const [state, action, pending] = useActionState(acceptTerms, null);
  const [athlete, setAthlete] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="terms_version" value={version} />
      <fieldset className="space-y-2 text-sm">
        <legend className="label">Are you a current U Sports student-athlete?</legend>
        <label className="flex items-center gap-2"><input type="radio" name="is_usports_athlete" value="no" defaultChecked onChange={() => setAthlete(false)} /> No</label>
        <label className="flex items-center gap-2"><input type="radio" name="is_usports_athlete" value="yes" onChange={() => setAthlete(true)} /> Yes</label>
      </fieldset>
      {athlete && (
        <fieldset className="space-y-2 text-sm">
          <legend className="label">Which sport(s) do you compete in?</legend>
          {sports.map((s) => (
            <label key={s.sport_id} className="flex items-center gap-2">
              <input type="checkbox" name="athlete_sports" value={s.sport_id} /> {s.sport_name}
            </label>
          ))}
        </fieldset>
      )}
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary" disabled={pending}><ShieldCheck className="size-4" /> Accept terms</button>
    </form>
  );
}

export function CreateLeagueForm({ sports, defaultSport }: { sports: Sport[]; defaultSport?: string }) {
  const [state, action, pending] = useActionState(createLeague, null);
  const usable = sports.filter((s) => s.ruleset_id);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="league_name">League name</label>
        <input id="league_name" name="league_name" required maxLength={80} className="input" placeholder="Vanier Cup Chasers" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="sport">Sport</label>
          <select id="sport" name="sport" className="input" defaultValue={defaultSport}>
            {usable.map((s) => <option key={s.sport_id} value={s.sport_id}>{s.sport_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="max_teams">Teams</label>
          <input id="max_teams" name="max_teams" type="number" min={2} max={20} defaultValue={10} className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="team_name">Your team name</label>
        <input id="team_name" name="team_name" required maxLength={60} className="input" placeholder="Commish FC" />
      </div>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary w-full" disabled={pending}><Plus className="size-4" /> Create league</button>
    </form>
  );
}

export function JoinLeagueForm() {
  const [state, action, pending] = useActionState(joinLeague, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="league_id">League ID</label>
          <input id="league_id" name="league_id" required className="input" placeholder="lg_12" />
        </div>
        <div>
          <label className="label" htmlFor="invite_code">Invite code</label>
          <input id="invite_code" name="invite_code" className="input" placeholder="3f9a1c2e" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="join_team_name">Your team name</label>
        <input id="join_team_name" name="team_name" required maxLength={60} className="input" />
      </div>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-ghost w-full" disabled={pending}><UserPlus className="size-4" /> Join league</button>
    </form>
  );
}
