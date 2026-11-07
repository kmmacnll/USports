import Link from 'next/link';

import type { Sport } from '@/lib/types';

import { chipClass } from './ui';

const SEASON_ORDER: Sport['season_type'][] = ['FALL', 'WINTER', 'SPRING'];

/**
 * Server-rendered sport chips (fall sports first), scrolling sideways on phones.
 * Sets ?<param>=<sport> and keeps the other params.
 */
export function SportTabs({ sports, active, param = 'sport', base, params = {}, className = '' }: {
  sports: Sport[]; active: string; param?: string; base: string; params?: Record<string, string | undefined>; className?: string;
}) {
  const rank = (s: Sport) => { const i = SEASON_ORDER.indexOf(s.season_type); return i < 0 ? 9 : i; };
  const ordered = sports.slice().sort((a, b) => rank(a) - rank(b));
  return (
    <nav aria-label="Sport" className={`no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 ${className}`}>
      {ordered.map((s) => {
        const q = new URLSearchParams(Object.entries({ ...params, [param]: s.sport_id }).filter(([, v]) => v) as [string, string][]);
        const on = s.sport_id === active;
        return (
          <Link key={s.sport_id} href={`${base}?${q}`} scroll={false} aria-current={on ? 'page' : undefined} className={chipClass(on)}>
            {s.sport_name}
          </Link>
        );
      })}
    </nav>
  );
}
