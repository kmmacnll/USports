import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PlayerPopover } from '@/components/player-popover';
import { SportTabs } from '@/components/sport-tabs';
import { Empty, fmt } from '@/components/ui';
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
    api<{ data: University[] }>('/universities', { auth: false, query: { sport: sport.sport_id }, revalidate: 300 }),
    api<Paginated<Athlete>>('/athletes', {
      auth: false,
      query: { sport: sport.sport_id, q: p.q, university: p.university, conference: p.conference, position: p.position,
               sort, page, page_size: PAGE_SIZE },
    }),
  ]);
  const conferences = [...new Set(universities.map((u) => u.conference).filter((c): c is string => !!c))].sort();
  const positions = sport.roster_limits ? Object.keys(sport.roster_limits).filter((k) => k !== 'BENCH' && k !== 'IR') : [];
  const { total } = results.pagination;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keep = { sport: sport.sport_id, q: p.q, university: p.university, conference: p.conference, position: p.position, sort };
  const href = (over: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v !== undefined && v !== '') q.set(k, String(v));
    return `/players?${q}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Players</h1>
          <p className="text-sm text-slate-400">{total.toLocaleString()} {sport.sport_name} athletes · {results.season} season · exhibitions excluded</p>
        </div>
        <SportTabs sports={sports} active={sport.sport_id} base="/players" />
      </div>

      <form method="get" className="glass grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input type="hidden" name="sport" value={sport.sport_id} />
        <div className="lg:col-span-2">
          <label className="label" htmlFor="q">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-500" />
            <input id="q" name="q" defaultValue={p.q} className="input pl-9" placeholder="Player name" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="university">University</label>
          <select id="university" name="university" defaultValue={p.university ?? ''} className="input">
            <option value="">All universities</option>
            {universities.map((u) => <option key={u.university_id} value={u.university_id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="conference">Conference</label>
          <select id="conference" name="conference" defaultValue={p.conference ?? ''} className="input"
            disabled={conferences.length === 0} title={conferences.length ? undefined : 'Conference data has not been loaded yet'}>
            <option value="">{conferences.length ? 'All conferences' : 'Not available yet'}</option>
            {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="position">Position</label>
          <select id="position" name="position" defaultValue={p.position ?? ''} className="input">
            <option value="">Any</option>
            {positions.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <select name="sort" defaultValue={sort} className="input" aria-label="Sort">
            <option value="fantasy_points">Top FP/G</option>
            <option value="name">Name</option>
          </select>
          <button className="btn-primary shrink-0">Apply</button>
        </div>
      </form>

      {results.data.length === 0 ? (
        <Empty>No athletes match these filters.</Empty>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="px-3 py-3 font-medium">University</th>
                <th className="px-3 py-3 font-medium">Conf</th>
                <th className="px-3 py-3 font-medium">Pos</th>
                <th className="px-3 py-3 text-right font-medium">GP</th>
                {sport.stat_columns.season.map((c) => <th key={c.key} className="px-3 py-3 text-right font-medium">{c.label}</th>)}
                <th className="px-4 py-3 text-right font-medium text-accent">FP/G</th>
              </tr>
            </thead>
            <tbody>
              {results.data.map((a) => (
                <tr key={a.athlete_id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <PlayerPopover athleteId={a.athlete_id} columns={sport.stat_columns}>
                      <span className="font-medium">{a.first_name} {a.last_name}</span>
                    </PlayerPopover>
                    {a.jersey_number && <span className="ml-1.5 text-xs text-slate-500">#{a.jersey_number}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{a.university}</td>
                  <td className="px-3 py-2.5 text-slate-400">{a.conference ?? '—'}</td>
                  <td className="px-3 py-2.5">{a.positions.length ? a.positions.map((x) => <span key={x} className="chip mr-1">{x}</span>) : <span className="text-slate-500">—</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{a.stats.games_played}</td>
                  {sport.stat_columns.season.map((c) => <td key={c.key} className="px-3 py-2.5 text-right tabular-nums text-slate-300">{fmt(a.stats[c.key])}</td>)}
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-accent">{fmt(a.stats.fantasy_points_avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-slate-400">Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="btn-ghost"><ChevronLeft className="size-4" /> Prev</Link>
              : <span className="btn-ghost opacity-40"><ChevronLeft className="size-4" /> Prev</span>}
            {page < pages ? <Link href={href({ page: page + 1 })} className="btn-ghost">Next <ChevronRight className="size-4" /></Link>
              : <span className="btn-ghost opacity-40">Next <ChevronRight className="size-4" /></span>}
          </div>
        </nav>
      )}
    </div>
  );
}
