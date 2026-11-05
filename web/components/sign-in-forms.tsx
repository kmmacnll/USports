'use client';

import { KeyRound, LogIn } from 'lucide-react';
import { useActionState, useState } from 'react';

import { signInAsDevUser, signInWithPin, signInWithToken } from '@/lib/actions';

import { ErrorNote } from './ui';

export function PinSignInForm({ rememberedName }: { rememberedName?: string }) {
  const [state, action, pending] = useActionState(signInWithPin, null);
  // Controlled: React resets uncontrolled fields after every form action, which
  // would wipe the name after a wrong PIN. The PIN field is meant to clear.
  const [name, setName] = useState(rememberedName ?? '');
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="name">Your name</label>
        <input id="name" name="name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)}
          autoComplete="name" className="input" placeholder="First and last name" />
        <p className="mt-1 text-xs text-slate-500">Your account and teams are tied to this name. Use the same one each time.</p>
      </div>
      <div>
        <label className="label" htmlFor="pin">PIN</label>
        <input id="pin" name="pin" required type="password" inputMode="numeric" pattern="[0-9]*" maxLength={12}
          autoComplete="current-password" autoFocus={!!rememberedName}
          className="input text-center font-mono text-2xl tracking-[0.6em]" placeholder="••••" />
      </div>
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-primary w-full" disabled={pending}><KeyRound className="size-4" /> {pending ? 'Checking…' : 'Enter'}</button>
    </form>
  );
}

export function TokenSignInForm() {
  const [state, action, pending] = useActionState(signInWithToken, null);
  return (
    <form action={action} className="space-y-3">
      <label className="label" htmlFor="token">Access token</label>
      <textarea id="token" name="token" rows={4} required className="input font-mono text-xs" placeholder="eyJhbGciOi…" />
      {state && !state.ok && <ErrorNote message={state.error.message} />}
      <button className="btn-ghost w-full" disabled={pending}><LogIn className="size-4" /> {pending ? 'Checking…' : 'Sign in with token'}</button>
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
