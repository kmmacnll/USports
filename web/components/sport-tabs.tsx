import Link from 'next/link';

import type { Sport } from '@/lib/types';

const SEASON_LABEL: Record<Sport['season_type'], string> = { FALL: 'Fall', WINTER: 'Winter', SPRING: 'Spring' };
const SEASON_ORDER: Sport['season_type'][] = ['FALL', 'WINTER', 'SPRING'];

/** Server-rendered sport switcher, grouped by season; sets ?<param>=<sport> and keeps other params. */
export function SportTabs({ sports, active, param = 'sport', base, params = {} }: {
  sports: Sport[]; active: string; param?: string; base: string; params?: Record<string, string | undefined>;
}) {
  // Sports with no (or an unknown) season_type still render, ungrouped, e.g.
  // from a cached /sports response made before the API added the field.
  const known = SEASON_ORDER.map((season) => ({ season: season as string, list: sports.filter((s) => s.season_type === season) }));
  const other = sports.filter((s) => !SEASON_ORDER.includes(s.season_type));
  const groups = [...known, { season: '', list: other }].filter((g) => g.list.length > 0);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-1">
      {groups.map(({ season, list }) => (
        <div key={season} className="flex flex-wrap items-center gap-1">
          {groups.length > 1 && season && (
            <span className="px-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {SEASON_LABEL[season as Sport['season_type']]}
            </span>
          )}
          {list.map((s) => {
            const q = new URLSearchParams(Object.entries({ ...params, [param]: s.sport_id }).filter(([, v]) => v) as [string, string][]);
            const on = s.sport_id === active;
            return (
              <Link key={s.sport_id} href={`${base}?${q}`} scroll={false}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${on ? 'bg-accent text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}>
                {s.sport_name}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
