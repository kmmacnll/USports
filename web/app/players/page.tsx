import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PlayerPopover } from '@/components/player-popover';
import { SportTabs } from '@/components/sport-tabs';
import { Empty, PageTitle, UniMark, chipClass, fmt } from '@/components/ui';
import { api } from '@/lib/api';
import type { Athlete, Paginated, Sport, University } from '@/lib/types';

export const metadata: Metadata = { title: 'Players' };
export const dynamic = 'force-dynamic';

type Params = { sport?: string; q?: string; university?: string; conference?: string; position?: string; sort?: string; page?: string };

const PAGE_SIZE = 25;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const { data: sports } = await api<{ data: Sport[] }>('/sports', { auth: false, revalidate: 300 });
  const sport = sports.find((s) => s.sport_id === p.sport) ?? sports.find((s) => s.sport_id === 'usports_mbk') ?? sports[0];
  if (!sport) return <Empty>No sports are available yet.</Empty>;

  const page = Math.max(1, Number(p.page) || 1);
  const sort = p.sort === 'name' ? 'name' : 'fantasy_points';
  const [{ data: universities }, results] = await Promise.all([
    api<{ data: University[] }>('/universities', { auth: false, query: { sport_id: sport.sport_id }, revalidate: 300 }),
    api<Paginated<Athlete>>('/athletes', {
      auth: false,
      query: { sport_id: sport.sport_id, q: p.q, university: p.university, conference: p.conference, position: p.position,
               sort, page, page_size: PAGE_SIZE },
    }),
  ]);
  const conferences = [...new Set(universities.map((u) => u.conference).filter((c): c is string => !!c))].sort();
  // Starter slots as position filters; wildcard ('*') slots don't narrow anything, so they're hidden.
  const positions = sport.roster_limits
    ? Object.keys(sport.roster_limits).filter((k) => k !== 'BENCH' && k !== 'IR'
        && !(sport.position_eligibility?.[k] ?? []).includes('*'))
    : [];
  const { total } = results.pagination;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keep = { sport: sport.sport_id, q: p.q, university: p.university, conference: p.conference, position: p.position, sort };
  const href = (over: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v !== undefined && v !== '') q.set(k, String(v));
    return `/players?${q}`;
  };
  const seasonCols = sport.stat_columns.season.slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle sub={`${sport.sport_name} · ${total.toLocaleString('en-CA')} players`}>Players</PageTitle>
      <SportTabs sports={sports} active={sport.sport_id} base="/players" />

      <form method="get" className="space-y-2.5">
        <input type="hidden" name="sport" value={sport.sport_id} />
        {p.position && <input type="hidden" name="position" value={p.position} />}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-ink-4" />
          <input type="search" name="q" defaultValue={p.q} className="input pl-11" placeholder="Search name" aria-label="Search players" />
        </label>
        <div className={`grid grid-cols-2 gap-2 ${conferences.length ? 'sm:grid-cols-[1fr_1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto_auto]'}`}>
          <select name="university" defaultValue={p.university ?? ''} className="input h-11 text-sm" aria-label="University">
            <option value="">All universities</option>
            {universities.map((u) => <option key={u.university_id} value={u.university_id}>{u.name}</option>)}
          </select>
          {conferences.length > 0 && (
            <select name="conference" defaultValue={p.conference ?? ''} className="input h-11 text-sm" aria-label="Conference">
              <option value="">All conferences</option>
              {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select name="sort" defaultValue={sort} className="input h-11 text-sm sm:w-auto" aria-label="Sort">
            <option value="fantasy_points">Top FP/G</option>
            <option value="name">Name</option>
          </select>
          <button className={`btn-primary h-11 ${conferences.length ? '' : 'col-span-2 sm:col-span-1'}`}>Apply</button>
        </div>
      </form>

      {positions.length > 1 && (
        <nav aria-label="Position" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {['', ...positions].map((pos) => (
            <Link key={pos || 'all'} href={href({ position: pos || undefined, page: undefined })} scroll={false}
              aria-current={(p.position ?? '') === pos ? 'page' : undefined} className={chipClass((p.position ?? '') === pos)}>
              {pos || 'All'}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex items-center justify-between px-1 pt-1 text-[10px] font-extrabold tracking-[.08em] text-ink-4">
        <span>{sort === 'name' ? 'A–Z' : 'BY FANTASY POINTS'}</span><span>FP/G · GP</span>
      </div>
      {results.data.length === 0 ? (
        <div className="tile"><Empty>No athletes match these filters.</Empty></div>
      ) : (
        <div className="tile rows overflow-hidden">
          {results.data.map((a, i) => (
            <PlayerPopover key={a.athlete_id} athleteId={a.athlete_id} columns={sport.stat_columns} className="w-full">
              <span className="flex min-h-[64px] items-center gap-3 px-4 py-2.5 transition hover:bg-white/[.03]">
                {sort !== 'name' && <span className="num hidden w-6 text-right text-[15px] text-ink-4 sm:block">{(page - 1) * PAGE_SIZE + i + 1}</span>}
                <UniMark name={a.university} id={a.university_id} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-ink">
                    {a.first_name} {a.last_name}{a.jersey_number && <span className="ml-1.5 text-xs font-semibold text-ink-4">#{a.jersey_number}</span>}
                  </span>
                  <span className="block truncate text-xs font-semibold text-ink-3">
                    {[a.positions.join('/') || null, a.university, a.conference].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="hidden gap-4 sm:flex">
                  {seasonCols.map((c) => (
                    <span key={c.key} className="flex w-11 flex-col items-end leading-none">
                      <span className="num text-[16px] text-ink-2">{fmt(a.stats[c.key])}</span>
                      <span className="mt-1 text-[9.5px] font-extrabold text-ink-4">{c.label}</span>
                    </span>
                  ))}
                </span>
                <span className="flex w-12 flex-col items-end leading-none">
                  <span className="num text-[22px] text-blue">{fmt(a.stats.fantasy_points_avg)}</span>
                  <span className="mt-1 text-[10px] font-bold text-ink-4">{a.stats.games_played} GP</span>
                </span>
              </span>
            </PlayerPopover>
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3 pt-1" aria-label="Pagination">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="btn-secondary h-10"><ChevronLeft className="size-4" /> Prev</Link>
            : <span className="btn-ghost h-10 opacity-40"><ChevronLeft className="size-4" /> Prev</span>}
          <span className="text-[13px] font-bold text-ink-3">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="btn-secondary h-10">Next <ChevronRight className="size-4" /></Link>
            : <span className="btn-ghost h-10 opacity-40">Next <ChevronRight className="size-4" /></span>}
        </nav>
      )}
    </div>
  );
}
