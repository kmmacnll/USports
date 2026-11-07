import Link from 'next/link';
import type { ReactNode } from 'react';

import { devSignInEnabled } from '@/lib/session';

import { DevSignInForm } from './sign-in-forms';

export function AuthCard({ mode, children }: { mode: 'signin' | 'signup'; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm space-y-5 sm:mt-6">
      <div className="flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/battles/varsityhq-logo-dark.png" alt="" className="h-20 w-auto drop-shadow-[0_12px_30px_rgba(0,0,0,.5)]" />
        <h1 className="display mt-3 text-[44px] leading-none">{mode === 'signin' ? 'Welcome back' : 'Join VarsityHQ'}</h1>
        <p className="mt-1.5 text-[13px] font-semibold text-ink-3">
          {mode === 'signin' ? 'Sign in to manage your leagues.' : 'Draft real Canadian university athletes.'}
        </p>
      </div>
      <div className="tile enter p-5">
        {children}
        <p className="mt-5 text-center text-[13px] font-semibold text-ink-3">
          {mode === 'signin'
            ? <>New here? <Link href="/signup" className="font-extrabold text-primary-text">Create account</Link></>
            : <>Have an account? <Link href="/login" className="font-extrabold text-primary-text">Sign in</Link></>}
        </p>
      </div>
      {devSignInEnabled() && (
        <div className="tile-gold p-4">
          <p className="section-title mb-2 text-gold">Local dev</p>
          <DevSignInForm />
        </div>
      )}
    </div>
  );
}
