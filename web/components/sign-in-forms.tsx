'use client';

import { LogIn, UserPlus } from 'lucide-react';
import { useActionState, useState } from 'react';

import { signIn, signInAsDevUser, signUp } from '@/lib/actions';

import { ErrorNote } from './ui';

// Controlled email field: React resets uncontrolled fields after every form
// action, which would wipe the email after a failed attempt.
function EmailField() {
  const [email, setEmail] = useState('');
  return (
    <div>
      <label className="label" htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" autoFocus
        value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
    </div>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="space-y-4">
      <EmailField />
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required maxLength={128} autoComplete="current-password" className="input" />
      </div>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary w-full" disabled={pending}><LogIn className="size-4" /> {pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mismatch = confirmation.length > 0 && password !== confirmation;
  return (
    <form action={action} className="space-y-4">
      <EmailField />
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password_confirmation">Confirm password</label>
        <input id="password_confirmation" name="password_confirmation" type="password" required minLength={8} maxLength={128}
          autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
          aria-invalid={mismatch} className={`input ${mismatch ? 'border-rose-500/60' : ''}`} />
      </div>
      {mismatch && <ErrorNote message="Passwords do not match" />}
      {!mismatch && state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary w-full" disabled={pending || mismatch}>
        <UserPlus className="size-4" /> {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

export function DevSignInForm() {
  const [state, action, pending] = useActionState(signInAsDevUser, null);
  return (
    <form action={action} className="flex gap-2">
      <input name="name" required className="input" placeholder="dev-user" aria-label="Dev user name" />
      <button className="btn-ghost shrink-0" disabled={pending}>Continue</button>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
    </form>
  );
}
