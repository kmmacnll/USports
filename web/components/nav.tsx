import { LogIn, LogOut } from 'lucide-react';
import Link from 'next/link';

import { getMe } from '@/lib/api';
import { signOut } from '@/lib/actions';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/** Slim header: logo home, plus sign in / sign out. Draft Battles is the whole site. */
export async function Nav() {
  const me = await getMe();
  return (
    <header className="sticky top-0 z-40 border-b border-white/[.06] bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="VarsityHQ home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/battles/varsityhq-logo-dark.png" alt="" className="h-9 w-auto" />
          <span className="text-[17px] font-extrabold tracking-tight">VarsityHQ</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {me ? (
            <>
              <span className="grid size-9 place-items-center rounded-full bg-navy text-[13px] font-extrabold" title={me.display_name} aria-label={`Signed in as ${me.display_name}`}>
                {initials(me.display_name)}
              </span>
              <form action={signOut}>
                <button className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-white/5 hover:text-ink" title="Sign out" aria-label="Sign out">
                  <LogOut className="size-[18px]" />
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn-primary h-9 px-3.5 text-[13px]">
              <LogIn className="size-4" /> Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
