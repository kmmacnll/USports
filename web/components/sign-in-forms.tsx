'use client';

import { LogIn } from 'lucide-react';
import { useActionState } from 'react';

import { signInAsDevUser, signInWithToken } from '@/lib/actions';

import { ErrorNote } from './ui';

export function TokenSignInForm() {
  const [state, action, pending] = useActionState(signInWithToken, null);
  return (
    <form action={action} className="space-y-3">
      <label className="label" htmlFor="token">Access token</label>
      <textarea id="token" name="token" rows={4} required className="input font-mono text-xs" placeholder="eyJhbGciOi…" />
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary w-full" disabled={pending}><LogIn className="size-4" /> {pending ? 'Checking…' : 'Sign in'}</button>
    </form>
  );
}

export function DevSignInForm() {
  const [state, action, pending] = useActionState(signInAsDevUser, null);
  return (
    <form action={action} className="flex gap-2">
      <input name="name" required className="input" placeholder="your-name" aria-label="Dev user name" />
      <button className="btn-ghost shrink-0" disabled={pending}>Continue</button>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
    </form>
  );
}
