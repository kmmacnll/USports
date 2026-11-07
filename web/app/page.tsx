import { ChevronRight, Plus, Swords } from 'lucide-react';
import Link from 'next/link';

import { LeagueSheetButton, TermsForm } from '@/components/dashboard-forms';
import { GameGroups } from '@/components/games';
import { PlayerPopover } from '@/components/player-popover';
import { SportTabs } from '@/components/sport-tabs';
import { Empty, SectionHead, SportMark, UniMark, fmt } from '@/components/ui';
import { api, apiOrNull, getMe } from '@/lib/api';
import type { Athlete, Game, League, LeagueTeam, Me, Paginated, Roster, Sport } from '@/lib/types';

export const dynamic = 'force-dynamic';

type MyLeague = Awaited<ReturnType<typeof loadMyLeagues>>[number];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const [{ data: sports }, me] = await Promise.all([
    api<{ data: Sport[] }>('/sports', { auth: false, revalidate: 300 }),
    getMe(),
  ]);
  const params = await searchParams;
  const activeSport = sports.find((s) => s.sport_id === params.sport)?.sport_id
    ?? me?.teams[0]?.sport ?? sports.find((s) => s.sport_id === 'usports_mbk')?.sport_id ?? sports[0]?.sport_id ?? '';
  const sport = sports.find((s) => s.sport_id === activeSport);

  const [leagues, games, top] = await Promise.all([
    me ? loadMyLeagues(me) : Promise.resolve([]),
    activeSport ? api<{ data: Game[] }>('/games', { auth: false, query: { sport_id: activeSport } }) : Promise.resolve({ data: [] }),
    activeSport ? api<Paginated<Athlete>>('/athletes', { auth: false, query: { sport_id: activeSport, page_size: 5 } }) : null,
  ]);
  const myUniversities = new Set(leagues.filter((l) => l.league.sport === activeSport).flatMap((l) => l.universities));
  const shownGames = pickGames(games.data, myUniversities, 6);
  const blocked = me?.is_usports_athlete ? me.athlete_sports : [];
  const sheet = { sports, defaultSport: activeSport, blocked };

  const performers = (
    <section className="space-y-2">
      <SectionHead title="Top performers" action={<Link href={`/players?sport=${activeSport}`} className="text-[13px] font-bold text-primary-text">All players</Link>} />
      <div className="tile rows overflow-hidden">
        {!top || top.data.length === 0 ? <Empty>No stats yet</Empty> : top.data.map((a, i) => (
          <PlayerPopover key={a.athlete_id} athleteId={a.athlete_id} columns={sport!.stat_columns} className="w-full">
            <span className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
              <span className="num w-4 text-right text-[15px] text-ink-4">{i + 1}</span>
              <UniMark name={a.university} id={a.university_id} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold text-ink">{a.first_name} {a.last_name}</span>
                <span className="block truncate text-xs font-semibold text-ink-3">{[a.position, a.university, `${a.stats.games_played} GP`].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="flex flex-col items-end leading-none">
                <span className="num text-[22px] text-blue">{fmt(a.stats.fantasy_points_avg)}</span>
                <span className="mt-1 text-[9.5px] font-extrabold tracking-[.06em] text-ink-4">FP/G</span>
              </span>
            </span>
          </PlayerPopover>
        ))}
      </div>
    </section>
  );

  const scores = (
    <section className="space-y-2">
      <SectionHead title={`Scores · ${sport?.sport_name ?? ''}`} action={<Link href={`/scores?sport=${activeSport}`} className="text-[13px] font-bold text-primary-text">All scores</Link>} />
      {shownGames.length === 0 ? <div className="tile"><Empty>No games this week</Empty></div> : <GameGroups games={shownGames} mine={myUniversities} />}
    </section>
  );

  if (!me) {
    return (
      <div className="space-y-6">
        <section className="tile-blue enter relative overflow-hidden px-5 pb-6 pt-8 sm:px-10 sm:py-12">
          <Streaks />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/battles/varsityhq-logo-dark.png" alt="" className="relative mb-5 h-20 w-auto drop-shadow-[0_12px_30px_rgba(0,0,0,.5)] sm:h-24" />
          <h1 className="display relative max-w-2xl text-[46px] leading-[.88] sm:text-7xl">Draft real Canadian university athletes.</h1>
          <p className="relative mt-3 max-w-md text-[15px] font-semibold text-ink-2">Score with real U Sports box scores, all season long.</p>
          <div className="relative mt-6 grid gap-2.5 sm:flex">
            <Link href="/signup" className="btn-primary h-[52px] px-8 text-base">Get started</Link>
            <Link href="/login" className="btn-secondary h-[52px] px-8 text-base">I have an account</Link>
          </div>
        </section>
        <SportTabs sports={sports} active={activeSport} base="/" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">{performers}{scores}</div>
      </div>
    );
  }

  const [first] = leagues;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink-3">Welcome back</p>
          <h1 className="display truncate text-[40px] leading-[.95] sm:text-5xl">{me.display_name}</h1>
        </div>
        <LeagueSheetButton {...sheet} mode="create" label="Create or join a league"
          className="grid size-11 flex-none place-items-center rounded-full bg-surface-2 ring-1 ring-blue/20 transition hover:bg-navy">
          <Plus className="size-5" />
        </LeagueSheetButton>
      </div>

      {me.terms.needs_acceptance && me.terms.current_version && (
        <section className="tile-primary enter p-5"><TermsForm version={me.terms.current_version} sports={sports} /></section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          {first ? <FeaturedLeague l={first} /> : (
            <section className="tile-blue enter relative overflow-hidden p-5 sm:p-7">
              <Streaks />
              <p className="relative text-[11px] font-extrabold uppercase tracking-[.1em] text-[#C9DAFB]">Season-long · Real box scores</p>
              <h2 className="display relative mt-2 text-[52px] leading-[.85]">Start a<br />league</h2>
              <p className="relative mt-2 max-w-xs text-[13px] font-semibold text-ink-2">Create one for your friends, or join with an invite from your commissioner.</p>
              <div className="relative mt-5 grid grid-cols-2 gap-2.5">
                <LeagueSheetButton {...sheet} mode="create" className="btn-primary h-12">Create league</LeagueSheetButton>
                <LeagueSheetButton {...sheet} mode="join" className="btn-secondary h-12">Join with code</LeagueSheetButton>
              </div>
            </section>
          )}

          {leagues.length > 0 && (
            <section className="space-y-2">
              <SectionHead id="leagues" title="My leagues"
                action={<LeagueSheetButton {...sheet} mode="join" className="py-1.5 text-[13px] font-bold text-primary-text">Join with code</LeagueSheetButton>} />
              <div className="tile rows overflow-hidden">
                {leagues.map((l) => (
                  <Link key={l.league.league_id} href={`/leagues/${l.league.league_id}`} className="flex min-h-[68px] items-center gap-3 px-4 py-3 transition hover:bg-white/[.03] active:bg-white/[.05]">
                    <SportMark sport={l.league.sport} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-extrabold">{l.league.league_name}</span>
                      <span className="block truncate text-xs font-semibold text-ink-3">{l.team?.team_name ?? 'Commissioner'} · {l.league.team_count}/{l.league.max_teams} teams</span>
                    </span>
                    {l.team && (
                      <span className="flex flex-col items-end leading-none">
                        <span className="num text-[22px]">#{l.rank}<span className="text-[15px] text-ink-4"> / {l.teams}</span></span>
                        <span className="mt-1 text-[11px] font-semibold text-ink-3">{fmt(l.team.roster_points)} pts</span>
                      </span>
                    )}
                    <ChevronRight className="size-4 flex-none text-ink-4" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <Link href="/battles" className="tile-live press flex items-center gap-3.5 px-4 py-3.5">
            <span className="grid size-11 flex-none place-items-center rounded-xl bg-live/15 text-live"><Swords className="size-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="display block text-[26px] leading-none">Draft Battles</span>
              <span className="block text-xs font-semibold text-ink-2">1v1 · 6 picks · live sim · ~3 min</span>
            </span>
            <ChevronRight className="size-5 text-ink-3" />
          </Link>
        </div>

        <div className="space-y-6">
          <SportTabs sports={sports} active={activeSport} base="/" />
          {performers}
          {scores}
        </div>
      </div>
    </div>
  );
}

/** Your first league, as the big card at the top of Home. */
function FeaturedLeague({ l }: { l: MyLeague }) {
  const { league, team } = l;
  const fill = team ? team.filled / team.roster_size : 0;
  return (
    <Link href={`/leagues/${league.league_id}`} className="tile-primary press enter relative block overflow-hidden p-5">
      <Streaks warm />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-2">
          <span className="size-[7px] rounded-full bg-live" style={{ animation: 'vhq-pulse 1.4s infinite' }} />Season points · {league.season}
        </span>
        <ChevronRight className="size-5 text-ink-3" />
      </div>
      <h2 className="display relative mt-3 truncate text-[44px] leading-[.9]">{league.league_name}</h2>
      <p className="relative mt-1 truncate text-[13px] font-bold text-ink-2">{team?.team_name ?? 'Commissioner'}</p>
      {team && (
        <>
          <div className="relative mt-5 flex items-end justify-between">
            <span className="leading-none">
              <span className="num text-[52px] leading-[.8]">#{l.rank}</span>
              <span className="num text-2xl text-ink-3"> / {l.teams}</span>
            </span>
            <span className="text-right leading-none">
              <span className="num block text-[40px] leading-[.85] text-blue">{fmt(team.roster_points)}</span>
              <span className="mt-1 block text-[10px] font-extrabold tracking-[.08em] text-ink-3">ROSTER PTS</span>
            </span>
          </div>
          <div className="relative mt-4 space-y-1.5">
            <div className="flex h-[5px] gap-0.5 overflow-hidden rounded-full">
              <div className="rounded-full bg-primary" style={{ width: `${fill * 100}%` }} />
              <div className="flex-1 rounded-full bg-white/10" />
            </div>
            <p className="flex justify-between text-[11px] font-bold text-ink-3"><span>Roster {team.filled}/{team.roster_size}</span><span>{league.team_count}/{league.max_teams} teams</span></p>
          </div>
        </>
      )}
    </Link>
  );
}

/** The diagonal light streaks from the Battles hero tiles. */
function Streaks({ warm = false }: { warm?: boolean }) {
  const c = warm ? 'rgba(255,138,61,.5)' : 'rgba(142,177,245,.55)';
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span className="absolute -top-1/3 left-[62%] h-[170%] w-0.5 rotate-[28deg]" style={{ background: `linear-gradient(transparent,${c},transparent)` }} />
      <span className="absolute -top-1/3 left-[72%] h-[170%] w-px rotate-[28deg]" style={{ background: 'linear-gradient(transparent,rgba(242,244,248,.3),transparent)' }} />
    </span>
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
