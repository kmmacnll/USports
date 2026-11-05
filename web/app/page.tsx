import { Activity, Calendar, Flame, Trophy, Users } from 'lucide-react';
import Link from 'next/link';

import { CreateLeagueForm, JoinLeagueForm, TermsForm } from '@/components/dashboard-forms';
import { PlayerPopover } from '@/components/player-popover';
import { SportTabs } from '@/components/sport-tabs';
import { Card, Empty, SportBadge, fmt } from '@/components/ui';
import { api, apiOrNull } from '@/lib/api';
import { getCredentials } from '@/lib/session';
import type { Athlete, Game, League, LeagueTeam, Me, Paginated, Roster, Sport } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const [{ data: sports }, signedIn] = await Promise.all([
    api<{ data: Sport[] }>('/sports', { auth: false, revalidate: 300 }),
    getCredentials().then(Boolean),
  ]);
  const me = signedIn ? await apiOrNull<Me>('/me') : null;
  const params = await searchParams;
  const activeSport = sports.find((s) => s.sport_id === params.sport)?.sport_id
    ?? me?.teams[0]?.sport ?? sports.find((s) => s.sport_id === 'usports_mbk')?.sport_id ?? sports[0]?.sport_id ?? '';
  const sport = sports.find((s) => s.sport_id === activeSport);

  const [leagues, games, top] = await Promise.all([
    me ? loadMyLeagues(me) : Promise.resolve([]),
    activeSport ? api<{ data: Game[] }>('/games', { auth: false, query: { sport_id: activeSport } }) : Promise.resolve({ data: [] }),
    activeSport ? api<Paginated<Athlete>>('/athletes', { auth: false, query: { sport_id: activeSport, page_size: 8 } }) : null,
  ]);
  const myUniversities = new Set(leagues.filter((l) => l.league.sport === activeSport).flatMap((l) => l.universities));
  const shownGames = pickGames(games.data, myUniversities, 12);

  return (
    <div className="space-y-6">
      <Hero me={me} />

      {me?.terms.needs_acceptance && me.terms.current_version && (
        <Card title="Terms & Conditions" className="border-accent/40">
          <TermsForm version={me.terms.current_version} sports={sports} />
        </Card>
      )}

      {me && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="My leagues" icon={<Trophy className="size-4 text-accent" />} className="lg:col-span-2">
            {leagues.length === 0 ? (
              <Empty>You&apos;re not in any leagues yet. Create one or join with an invite code.</Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {leagues.map(({ league, team, rank, teams }) => (
                  <Link key={league.league_id} href={`/leagues/${league.league_id}`}
                    className="group rounded-xl border border-white/10 bg-slate-950/40 p-4 transition hover:border-accent/50 hover:bg-slate-950/60">
                    <div className="flex items-center justify-between gap-2">
                      <SportBadge sport={league.sport} />
                      <span className="text-xs text-slate-500">{league.team_count}/{league.max_teams} teams</span>
                    </div>
                    <p className="mt-2 font-semibold group-hover:text-accent">{league.league_name}</p>
                    <p className="text-sm text-slate-400">{team?.team_name ?? 'Commissioner'}</p>
                    {team && (
                      <div className="mt-3 flex items-end justify-between text-sm">
                        <span className="text-slate-400">Rank <span className="font-bold text-white">{rank}</span>/{teams}</span>
                        <span className="tabular-nums"><span className="font-bold text-accent">{fmt(team.roster_points)}</span> pts</span>
                      </div>
                    )}
                    {team && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-accent" style={{ width: `${(team.filled / team.roster_size) * 100}%` }} />
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <div className="space-y-6">
            <Card title="Create a league" icon={<Users className="size-4 text-accent" />}>
              <CreateLeagueForm sports={sports} defaultSport={activeSport} />
            </Card>
            <Card title="Join a league">
              <JoinLeagueForm />
            </Card>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SportTabs sports={sports} active={activeSport} base="/" />
        {sport?.season && <span className="text-xs text-slate-500">{sport.season} season · {sport.ruleset_name} scoring</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Games" icon={<Calendar className="size-4 text-accent" />} className="lg:col-span-3"
          action={<span className="text-xs text-slate-500">{games.data.length ? `${shownGames.length} of ${games.data.length} · last 3 days, next 4` : ''}</span>}>
          {games.data.length === 0 ? (
            <Empty>No {sport?.sport_name ?? ''} games in the last 3 days or the next 4.</Empty>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {shownGames.map((g) => <GameRow key={g.game_id} game={g} mine={myUniversities} />)}
            </ul>
          )}
          {me && myUniversities.size > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
              <span className="size-2 rounded-full bg-accent" /> Your rostered players&apos; teams
            </p>
          )}
        </Card>

        <Card title="Top performers" icon={<Flame className="size-4 text-accent" />} className="lg:col-span-2"
          action={<Link href={`/players?sport=${activeSport}`} className="text-xs text-accent hover:underline">All players</Link>}>
          {!top || top.data.length === 0 ? (
            <Empty>No stats yet this season.</Empty>
          ) : (
            <ol className="space-y-1">
              {top.data.map((a, i) => (
                <li key={a.athlete_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <span className="w-5 text-right text-xs font-bold text-slate-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <PlayerPopover athleteId={a.athlete_id} columns={sport!.stat_columns}>
                      <span className="font-medium">{a.first_name} {a.last_name}</span>
                    </PlayerPopover>
                    <p className="truncate text-xs text-slate-500">{a.university} · {a.stats.games_played} GP</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums text-accent">{fmt(a.stats.fantasy_points_avg)}</p>
                    <p className="text-[10px] uppercase text-slate-500">FP/G</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Hero({ me }: { me: Me | null }) {
  if (me) {
    return (
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Welcome back</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{me.display_name}</h1>
        </div>
        <Activity className="hidden size-8 text-accent/60 sm:block" />
      </div>
    );
  }
  return (
    <div className="glass overflow-hidden p-8 sm:p-10">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">U Sports fantasy</p>
      <h1 className="mt-2 max-w-2xl text-3xl font-black tracking-tight sm:text-5xl">
        Draft real Canadian university athletes. Score with real box scores.
      </h1>
      <p className="mt-4 max-w-xl text-slate-400">Basketball and football leagues built on every U Sports game, updated daily.</p>
      <Link href="/login" className="btn-primary mt-6">Get started</Link>
    </div>
  );
}

function GameRow({ game, mine }: { game: Game; mine: Set<string> }) {
  const final = game.status === 'FINAL';
  const side = (t: Game['home'], other: Game['home']) => (
    <div className="flex items-center justify-between gap-2">
      <span className={`flex items-center gap-1.5 truncate ${final && (t.score ?? 0) > (other.score ?? 0) ? 'font-semibold text-white' : 'text-slate-300'}`}>
        {mine.has(t.name) && <span className="size-2 shrink-0 rounded-full bg-accent" title="Your player's team" />}
        {t.name}
      </span>
      <span className="tabular-nums">{t.score ?? ''}</span>
    </div>
  );
  return (
    <li className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{new Date(`${game.date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span className="flex gap-1">
          {game.exhibition && <span className="chip">EXH</span>}
          {game.playoff && <span className="chip bg-accent/20 text-accent">PLAYOFF</span>}
          <span className={final ? 'text-slate-400' : 'text-accent'}>{final ? 'Final' : 'Upcoming'}</span>
        </span>
      </div>
      {side(game.away, game.home)}
      {side(game.home, game.away)}
    </li>
  );
}

async function loadMyLeagues(me: Me) {
  const ids = [...new Set(me.teams.map((t) => t.league_id))];
  return Promise.all(ids.map(async (id) => {
    const [league, teams, roster] = await Promise.all([
      api<League>(`/leagues/${id}`),
      api<{ data: LeagueTeam[] }>(`/leagues/${id}/teams`),
      apiOrNull<Roster>(`/leagues/${id}/roster`),
    ]);
    const idx = teams.data.findIndex((t) => t.is_mine);
    return {
      league,
      team: teams.data[idx],
      rank: idx + 1,
      teams: teams.data.length,
      universities: roster?.slots.flatMap((s) => (s.athlete ? [s.athlete.university] : [])) ?? [],
    };
  }));
}

/**
 * Up to `n` games: ones involving your rostered players' teams first, then
 * the most recent results, then the next upcoming games; shown in date order.
 */
function pickGames(games: Game[], mine: Set<string>, n: number): Game[] {
  const involves = (g: Game) => mine.has(g.home.name) || mine.has(g.away.name);
  const finals = games.filter((g) => g.status === 'FINAL').reverse();
  const upcoming = games.filter((g) => g.status !== 'FINAL');
  const ordered = [...games.filter(involves), ...finals, ...upcoming];
  const picked = [...new Map(ordered.map((g) => [g.game_id, g])).values()].slice(0, n);
  return picked.sort((a, b) => a.date.localeCompare(b.date));
}
