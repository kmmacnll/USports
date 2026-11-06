import { Shield } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { devSignInEnabled } from '@/lib/session';

import { DevSignInForm } from './sign-in-forms';

export function AuthCard({ mode, children }: { mode: 'signin' | 'signup'; children: ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-sm space-y-6">
      <div className="glass p-6">
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-accent text-slate-950"><Shield className="size-6" strokeWidth={2.5} /></span>
          <h1 className="mt-3 text-xl font-bold">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        </div>
        {children}
        <p className="mt-5 text-center text-sm">
          {mode === 'signin'
            ? <Link href="/signup" className="text-accent hover:underline">Create account</Link>
            : <Link href="/login" className="text-accent hover:underline">Sign in</Link>}
        </p>
      </div>
      {devSignInEnabled() && <div className="glass border-amber-500/30 p-4"><DevSignInForm /></div>}
    </div>
  );
}
