import { Swords, Trophy, UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AddPlayers } from '@/components/add-players';
import { CopyButton } from '@/components/copy-button';
import { RosterGrid } from '@/components/roster-grid';
import { Card, Empty, SportBadge, fmt } from '@/components/ui';
import { api, apiOrNull } from '@/lib/api';
import { getCredentials } from '@/lib/session';
import type { League, LeagueTeam, Roster, Sport } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const league = (await getCredentials()) ? await apiOrNull<League>(`/leagues/${(await params).id}`).catch(() => null) : null;
  return { title: league?.league_name ?? 'League' };
}

export default async function LeaguePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ team?: string }>;
}) {
  const { id } = await params;
  const { team: teamParam } = await searchParams;
  if (!(await getCredentials())) redirect('/login');

  const league = await apiOrNull<League>(`/leagues/${encodeURIComponent(id)}`);
  if (!league) notFound();
  const [{ data: teams }, { data: sports }] = await Promise.all([
    api<{ data: LeagueTeam[] }>(`/leagues/${league.league_id}/teams`),
    api<{ data: Sport[] }>('/sports', { auth: false, revalidate: 300, query: { include_inactive: true } }),
  ]);
  const sport = sports.find((s) => s.sport_id === league.sport);
  const columns = sport?.stat_columns ?? { season: [], game: [] };
  const viewingTeam = teamParam ?? league.my_team_id ?? undefined;
  const roster = viewingTeam
    ? await apiOrNull<Roster>(`/leagues/${league.league_id}/roster`, { query: { team_id: viewingTeam } })
    : null;
  const editable = !!roster && roster.team.team_id === league.my_team_id;
  const starterSlots = Object.keys(league.roster_limits).filter((k) => k !== 'BENCH' && k !== 'IR');

  return (
    <div className="space-y-6">
      <div className="glass flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-2"><SportBadge sport={league.sport} /><span className="text-xs text-slate-500">{league.season}</span></div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{league.league_name}</h1>
          <p className="text-sm text-slate-400">
            {league.ruleset_name} · {league.team_count}/{league.max_teams} teams · {league.roster_size}-player rosters (
            {Object.entries(league.roster_limits).map(([k, v]) => `${v} ${k}`).join(', ')})
          </p>
        </div>
        {league.invite_code && (
          <div className="text-right text-xs text-slate-400">
            <p className="mb-1">Invite: league <span className="font-mono text-slate-200">{league.league_id}</span></p>
            <CopyButton value={league.invite_code} label="invite code" />
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={roster ? roster.team.team_name : 'Roster'} icon={<Swords className="size-4 text-accent" />}
            action={roster && <span className="text-xs text-slate-500">{roster.filled}/{roster.roster_size} filled{editable ? '' : ' · view only'}</span>}>
            {roster ? (
              <RosterGrid leagueId={league.league_id} slots={roster.slots} eligibility={league.position_eligibility}
                editable={editable} columns={columns} />
            ) : (
              <Empty>You don&apos;t have a team in this league. Join from the dashboard with league ID {league.league_id} and the invite code.</Empty>
            )}
          </Card>
          {editable && roster && (
            <Card title="Add players" icon={<UserPlus className="size-4 text-accent" />}>
              <AddPlayers leagueId={league.league_id} positions={starterSlots} columns={columns}
                rosterFull={roster.filled >= roster.roster_size} />
            </Card>
          )}
        </div>

        <Card title="Teams" icon={<Trophy className="size-4 text-accent" />} className="h-fit"
          action={<span className="text-[11px] text-slate-500">season pts, current rosters</span>}>
          {teams.length === 0 ? <Empty>No teams yet.</Empty> : (
            <ol className="space-y-1">
              {teams.map((t, i) => (
                <li key={t.team_id}>
                  <Link href={`/leagues/${league.league_id}?team=${t.team_id}`} scroll={false}
                    className={`flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5 ${roster?.team.team_id === t.team_id ? 'bg-white/5 ring-1 ring-accent/40' : ''}`}>
                    <span className="w-5 text-right text-xs font-bold text-slate-500">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{t.team_name} {t.is_mine && <span className="chip ml-1 bg-accent/20 text-accent">YOU</span>}</p>
                      <p className="truncate text-xs text-slate-500">{t.owner_name} · {t.filled}/{t.roster_size}</p>
                    </div>
                    <span className="font-bold tabular-nums text-accent">{fmt(t.roster_points)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
