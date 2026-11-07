'use client';

import { CalendarDays, House, Search, Swords, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { key: string; href: string; label: string; icon: LucideIcon };

const items = (leagueHref: string): Item[] => [
  { key: 'home', href: '/', label: 'Home', icon: House },
  { key: 'league', href: leagueHref, label: 'League', icon: Trophy },
  { key: 'players', href: '/players', label: 'Players', icon: Search },
  { key: 'scores', href: '/scores', label: 'Scores', icon: CalendarDays },
  { key: 'battles', href: '/battles', label: 'Battles', icon: Swords },
];

function activeKey(path: string) {
  if (path === '/') return 'home';
  if (path.startsWith('/leagues')) return 'league';
  return path.split('/')[1] ?? '';
}

/** Desktop links in the header. */
export function NavLinks({ leagueHref }: { leagueHref: string }) {
  const active = activeKey(usePathname());
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
      {items(leagueHref).map(({ key, href, label }) => (
        <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}
          className={`rounded-full px-3 py-1.5 text-[13px] font-bold transition ${active === key ? 'bg-white/10 text-ink' : 'text-ink-3 hover:text-ink'}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Phone tab bar, pinned to the bottom. Battles draws its own full-screen UI, so it's hidden there. */
export function TabBar({ leagueHref }: { leagueHref: string }) {
  const path = usePathname();
  if (path.startsWith('/battles') || path.startsWith('/mobile')) return null;
  const active = activeKey(path);
  return (
    <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.06] bg-bg/90 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)' }}>
      <div className="mx-auto grid h-[58px] max-w-md grid-cols-5 px-1">
        {items(leagueHref).map(({ key, href, label, icon: Icon }) => {
          const on = active === key;
          return (
            <Link key={key} href={href} aria-current={on ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-bold transition-colors ${on ? 'text-primary-text' : 'text-ink-4'}`}>
              <Icon className="size-[22px]" strokeWidth={on ? 2.4 : 1.9} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
