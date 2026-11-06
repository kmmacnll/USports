import { LayoutDashboard, LogIn, LogOut, Search, Shield } from 'lucide-react';
import Link from 'next/link';

import { getMe } from '@/lib/api';
import { signOut } from '@/lib/actions';

export async function Nav() {
  const me = await getMe();
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-900/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-slate-950">
            <Shield className="size-4" strokeWidth={2.5} />
          </span>
          <span>Varsity<span className="text-accent">HQ</span></span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
            <LayoutDashboard className="size-4" /> <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <Link href="/players" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
            <Search className="size-4" /> <span className="hidden sm:inline">Players</span>
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {me ? (
            <>
              <span className="hidden text-slate-400 sm:inline">{me.display_name}</span>
              <form action={signOut}>
                <button className="btn-ghost py-1.5" title="Sign out">
                  <LogOut className="size-4" />
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn-primary py-1.5">
              <LogIn className="size-4" /> Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
