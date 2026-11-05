import Link from 'next/link';

import type { Sport } from '@/lib/types';

/** Server-rendered tabs that set ?<param>=<sport> while keeping other params. */
export function SportTabs({ sports, active, param = 'sport', base, params = {} }: {
  sports: Sport[]; active: string; param?: string; base: string; params?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-950/40 p-1">
      {sports.map((s) => {
        const q = new URLSearchParams(Object.entries({ ...params, [param]: s.sport_id }).filter(([, v]) => v) as [string, string][]);
        const on = s.sport_id === active;
        return (
          <Link key={s.sport_id} href={`${base}?${q}`} scroll={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${on ? 'bg-accent text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}>
            {s.sport_name}
          </Link>
        );
      })}
    </div>
  );
}
