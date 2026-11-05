import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';

import { DevSignInForm, TokenSignInForm } from '@/components/sign-in-forms';
import { devSignInEnabled } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="mx-auto mt-10 max-w-lg space-y-6">
      <div className="glass p-6">
        <h1 className="flex items-center gap-2 text-xl font-bold"><KeyRound className="size-5 text-accent" /> Sign in</h1>
        <p className="mt-2 text-sm text-slate-400">
          VarsityHQ doesn&apos;t have account sign-up yet. For now, paste an API access token (your admin can mint one with{' '}
          <code className="text-slate-300">npm run token</code>). It&apos;s stored in a secure, httpOnly cookie.
        </p>
        <div className="mt-5"><TokenSignInForm /></div>
      </div>
      {devSignInEnabled() && (
        <div className="glass border-amber-500/30 p-6">
          <p className="text-sm font-semibold text-amber-300">Local development</p>
          <p className="mt-1 text-sm text-slate-400">Continue as any name (sent as <code>X-Dev-User</code>; needs the API&apos;s AUTH_DEV_HEADER=true).</p>
          <div className="mt-4"><DevSignInForm /></div>
        </div>
      )}
    </div>
  );
}
