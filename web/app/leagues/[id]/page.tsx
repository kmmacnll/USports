import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AddPlayers } from '@/components/add-players';
import { CopyButton } from '@/components/copy-button';
import { RosterGrid } from '@/components/roster-grid';
import { Empty, SportBadge, fmt } from '@/components/ui';
import { api, apiOrNull } from '@/lib/api';
import { getCredentials } from '@/lib/session';
import type { League, LeagueTeam, Roster, Sport } from '@/lib/types';

export const dynamic = 'force-dynamic';

type View = 'roster' | 'standings' | 'add';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const league = (await getCredentials()) ? await apiOrNull<League>(`/leagues/${(await params).id}`).catch(() => null) : null;
  return { title: league?.league_name ?? 'League' };
}

export default async function LeaguePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ team?: string; view?: string }>;
}) {
  const { id } = await params;
  const { team: teamParam, view: viewParam } = await searchParams;
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
  const canAdd = !!league.my_team_id;
  const starterSlots = Object.keys(league.roster_limits).filter((k) => k !== 'BENCH' && k !== 'IR');
  const view: View = viewParam === 'standings' || (viewParam === 'add' && canAdd) ? viewParam : 'roster';
  const myRoster = editable ? roster : league.my_team_id
    ? await apiOrNull<Roster>(`/leagues/${league.league_id}/roster`) : null;
  const base = `/leagues/${league.league_id}`;
  const segs: [View, string][] = [['roster', 'Roster'], ['standings', 'Standings'], ...(canAdd ? [['add', 'Add players'] as [View, string]] : [])];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <SportBadge sport={league.sport} name={sport?.sport_name} />
          <span className="text-xs font-bold text-ink-4">{league.season} · {league.team_count}/{league.max_teams} teams</span>
        </div>
        <h1 className="display text-[42px] leading-[.9] sm:text-6xl">{league.league_name}</h1>
        <p className="text-[13px] font-semibold text-ink-3">{sport?.sport_name ?? league.sport} · {league.ruleset_name} · Season points</p>
      </div>

      {league.invite_code && (
        <div className="tile flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="section-title">Invite friends</p>
            <p className="mt-0.5 text-xs font-semibold text-ink-3">They’ll need the league ID and the code.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={league.league_id} label="league ID" />
            <CopyButton value={league.invite_code} label="invite code" />
          </div>
        </div>
      )}

      <nav aria-label="League view" className="grid rounded-2xl bg-bg/70 p-1 ring-1 ring-blue/15" style={{ gridTemplateColumns: `repeat(${segs.length},1fr)` }}>
        {segs.map(([k, l]) => (
          <Link key={k} href={k === 'roster' ? base : `${base}?view=${k}`} scroll={false} aria-current={view === k ? 'page' : undefined}
            className={`grid h-10 place-items-center rounded-xl text-[13px] font-extrabold transition ${view === k ? 'bg-navy text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.1),inset_0_0_0_1px_rgba(142,177,245,.3)]' : 'text-ink-3 hover:text-ink'}`}>
            {l}
          </Link>
        ))}
      </nav>

      {view === 'roster' && (
        roster ? (
          <div className="enter space-y-4">
            {!editable && (
              <div className="flex items-center justify-between gap-3 px-1">
                <div className="min-w-0">
                  <p className="section-title">Viewing</p>
                  <p className="truncate text-lg font-extrabold">{roster.team.team_name}</p>
                </div>
                {league.my_team_id && <Link href={base} className="btn-ghost h-9 px-3 text-[13px]"><ArrowLeft className="size-4" /> My team</Link>}
              </div>
            )}
            <RosterGrid key={roster.team.team_id} leagueId={league.league_id} slots={roster.slots} eligibility={league.position_eligibility}
              editable={editable} columns={columns} addHref={canAdd ? `${base}?view=add` : undefined} />
          </div>
        ) : (
          <div className="tile"><Empty>You don’t have a team in this league.</Empty></div>
        )
      )}

      {view === 'standings' && (
        <div className="enter space-y-2">
          <div aria-hidden className="grid grid-cols-[30px_1fr_70px] gap-3 px-5 text-[10px] font-extrabold uppercase tracking-[.08em] text-ink-4">
            <span>#</span><span>Team</span><span className="text-right">Points</span>
          </div>
          <div className="tile rows overflow-hidden">
            {teams.length === 0 ? <Empty>No teams yet</Empty> : teams.map((t, i) => (
              <Link key={t.team_id} href={t.is_mine ? base : `${base}?team=${t.team_id}`} scroll={false}
                className={`grid min-h-[62px] grid-cols-[30px_1fr_70px] items-center gap-3 px-4 py-2.5 transition hover:bg-white/[.03] ${t.is_mine ? 'bg-primary/[.09]' : ''}`}>
                <span className={`num text-center text-[22px] ${i === 0 ? 'text-gold' : t.is_mine ? 'text-primary-text' : ''}`}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-extrabold">
                    {t.team_name}{t.is_mine && <span className="ml-2 rounded-full bg-primary/20 px-1.5 py-0.5 align-middle text-[9.5px] font-extrabold tracking-[.06em] text-primary-text">YOU</span>}
                  </span>
                  <span className="block truncate text-xs font-semibold text-ink-3">{t.owner_name} · roster {t.filled}/{t.roster_size}</span>
                </span>
                <span className="num text-right text-[20px] text-blue">{fmt(t.roster_points)}</span>
              </Link>
            ))}
          </div>
          <p className="px-2 pt-1 text-[11.5px] leading-relaxed text-ink-4">
            Ranked by total roster points this season. Tap a team to see its roster. Weekly head-to-head matchups are coming once the league schedule is in the API.
          </p>
        </div>
      )}

      {view === 'add' && myRoster && (
        <div className="enter">
          <AddPlayers leagueId={league.league_id} positions={starterSlots} columns={columns}
            rosterFull={myRoster.filled >= myRoster.roster_size} filled={myRoster.filled} size={myRoster.roster_size} />
        </div>
      )}
    </div>
  );
}
