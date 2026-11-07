import type { Metadata } from 'next';
import Link from 'next/link';

import { GameGroups } from '@/components/games';
import { SportTabs } from '@/components/sport-tabs';
import { Empty, PageTitle } from '@/components/ui';
import { api, apiOrNull, getMe } from '@/lib/api';
import type { Game, Roster, Sport } from '@/lib/types';

export const metadata: Metadata = { title: 'Scores' };
export const dynamic = 'force-dynamic';

const TZ = 'America/Toronto';
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default async function ScoresPage({ searchParams }: { searchParams: Promise<{ sport?: string; date?: string }> }) {
  const p = await searchParams;
  const [{ data: sports }, me] = await Promise.all([
    api<{ data: Sport[] }>('/sports', { auth: false, revalidate: 300 }),
    getMe(),
  ]);
  const sport = sports.find((s) => s.sport_id === p.sport)
    ?? sports.find((s) => s.sport_id === me?.teams[0]?.sport) ?? sports.find((s) => s.sport_id === 'usports_mbk') ?? sports[0];
  if (!sport) return <Empty>No sports are available yet.</Empty>;

  const today = isoDay(new Date());
  const from = addDays(today, -3), to = addDays(today, 4);
  const [games, mine] = await Promise.all([
    api<{ data: Game[] }>('/games', { auth: false, query: { sport_id: sport.sport_id, from, to } }),
    myUniversities(me?.teams.filter((t) => t.sport === sport.sport_id).map((t) => t.league_id) ?? []),
  ]);

  const days = Array.from({ length: 8 }, (_, i) => addDays(from, i));
  const counts = new Map<string, number>();
  for (const g of games.data) counts.set(g.date, (counts.get(g.date) ?? 0) + 1);
  // Default to today, else the nearest day with games.
  const nearest = [...counts.keys()].sort((a, b) => Math.abs(+new Date(a) - +new Date(today)) - Math.abs(+new Date(b) - +new Date(today)))[0];
  const day = p.date && days.includes(p.date) ? p.date : counts.has(today) ? today : nearest ?? today;
  const list = games.data.filter((g) => g.date === day);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle sub={sport.sport_name}>Scores</PageTitle>
      <SportTabs sports={sports} active={sport.sport_id} base="/scores" />
      <nav aria-label="Day" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {days.map((d) => {
          const on = d === day, n = counts.get(d) ?? 0;
          const dt = new Date(`${d}T12:00:00`);
          return (
            <Link key={d} href={`/scores?sport=${sport.sport_id}&date=${d}`} scroll={false} aria-current={on ? 'date' : undefined}
              className={`flex h-[60px] w-[62px] flex-none flex-col items-center justify-center rounded-2xl transition ${on ? 'tile-blue' : n ? 'bg-surface/80 ring-1 ring-blue/10' : 'opacity-45'}`}>
              <span className={`text-[10px] font-extrabold uppercase tracking-[.08em] ${on ? 'text-[#C9DAFB]' : 'text-ink-4'}`}>
                {d === today ? 'Today' : dt.toLocaleDateString('en-CA', { weekday: 'short' })}
              </span>
              <span className="num text-[22px] leading-none">{dt.getDate()}</span>
              <span className="text-[9.5px] font-bold text-ink-4">{n ? `${n} game${n === 1 ? '' : 's'}` : '—'}</span>
            </Link>
          );
        })}
      </nav>
      {list.length === 0 ? (
        <div className="tile"><Empty>No {sport.sport_name} games on this day</Empty></div>
      ) : (
        <GameGroups games={list} mine={mine} />
      )}
      {mine.size > 0 && (
        <p className="flex items-center gap-2 px-1 text-[11px] font-semibold text-ink-4">
          <span className="size-1.5 rounded-full bg-primary" />Your rostered players play for this team
        </p>
      )}
    </div>
  );
}

async function myUniversities(leagueIds: string[]) {
  const rosters = await Promise.all(leagueIds.map((id) => apiOrNull<Roster>(`/leagues/${id}/roster`)));
  return new Set(rosters.flatMap((r) => r?.slots.flatMap((s) => (s.athlete ? [s.athlete.university] : [])) ?? []));
}
