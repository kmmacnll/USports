import { Shield } from 'lucide-react';
import type { Metadata } from 'next';

import { DevSignInForm, PinSignInForm, TokenSignInForm } from '@/components/sign-in-forms';
import { devSignInEnabled, getRememberedName } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const rememberedName = await getRememberedName();
  return (
    <div className="mx-auto mt-10 max-w-sm space-y-6">
      <div className="glass p-6">
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-accent text-slate-950"><Shield className="size-6" strokeWidth={2.5} /></span>
          <h1 className="mt-3 text-xl font-bold">{rememberedName ? `Welcome back, ${rememberedName.split(' ')[0]}` : 'Enter VarsityHQ'}</h1>
          <p className="mt-1 text-sm text-slate-400">Enter the access PIN to continue.</p>
        </div>
        <PinSignInForm rememberedName={rememberedName} />
      </div>

      <details className="glass p-4 text-sm">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Advanced: sign in with an access token</summary>
        <div className="mt-4"><TokenSignInForm /></div>
      </details>

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
