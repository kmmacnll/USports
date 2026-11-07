import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { BattlesApp } from '@/components/battles/battles-app';
import { fromApi, type ApiPlayer, type Player } from '@/components/battles/data';
import type { MyLeague } from '@/components/battles/leagues';
import { api, apiOrNull, getMe } from '@/lib/api';
import type { Me } from '@/lib/types';

import './battles.css';

export const dynamic = 'force-dynamic';

/**
 * School slugs with a logo file: web/public/logos/<slug>.png (slug = the API's
 * `school_id`, i.e. universities.slug). Cards only show logos that exist.
 */
async function loadLogos(): Promise<Set<string>> {
  try {
    const files = await readdir(path.join(process.cwd(), 'public', 'logos'));
    return new Set(files.filter((f) => f.toLowerCase().endsWith('.png')).map((f) => f.slice(0, -4)));
  } catch {
    return new Set();
  }
}

/** Real U Sports hockey players with Draft Battles ratings. Empty until the ratings job has run. */
async function loadPool(gender: 'women' | 'men', logos: Set<string>): Promise<Player[]> {
  try {
    const res = await api<{ data: ApiPlayer[] }>('/players', { auth: false, revalidate: 300, query: { sport: 'hockey', gender, page_size: 200 } });
    return res.data.map((a) => fromApi(a, logos)).filter((p): p is Player => p !== null);
  } catch {
    return [];
  }
}

type ApiLeague = { league_id: string; league_name: string; sport: string; season: string; max_teams: number; team_count: number; roster_size: number };
type ApiTeam = { team_id: string; team_name: string; is_mine: boolean; filled: number; roster_size: number; roster_points: number };

/** Your season-long fantasy leagues for the My Leagues screen. A league that fails to load is left out. */
async function loadLeagues(me: Me | null): Promise<MyLeague[]> {
  if (!me) return [];
  const [sports, rows] = await Promise.all([
    apiOrNull<{ data: { sport_id: string; sport_name: string }[] }>('/sports', { auth: false, revalidate: 300, query: { include_inactive: true } }),
    Promise.all([...new Set(me.teams.map((t) => t.league_id))].map(async (id) => {
      const [league, teams] = await Promise.all([apiOrNull<ApiLeague>(`/leagues/${id}`), apiOrNull<{ data: ApiTeam[] }>(`/leagues/${id}/teams`)]);
      return league && teams ? { league, teams: teams.data } : null;
    })),
  ]);
  const name = (code: string) => sports?.data.find((s) => s.sport_id === code)?.sport_name ?? code;
  return rows.flatMap((r) => {
    if (!r) return [];
    const i = r.teams.findIndex((t) => t.is_mine);
    const mine = r.teams[i];
    return [{
      id: r.league.league_id, name: r.league.league_name, sport: r.league.sport, sportName: name(r.league.sport), season: r.league.season,
      team: mine?.team_name ?? null, rank: mine ? i + 1 : null, teams: r.teams.length,
      points: mine?.roster_points ?? null, filled: mine?.filled ?? null, size: mine?.roster_size ?? null,
    }];
  });
}

/** The whole site is Draft Battles: full-bleed below the 56px header, a phone-width column on larger screens. */
export default async function HomePage() {
  const logos = await loadLogos();
  const [me, women, men] = await Promise.all([getMe(), loadPool('women', logos), loadPool('men', logos)]);
  const leagues = await loadLeagues(me);
  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-30 bg-[#05080F]">
      <div className="mx-auto h-full w-full max-w-[430px] sm:border-x sm:border-white/10">
        <BattlesApp displayName={me?.display_name ?? null} pools={{ W: women, M: men }} leagues={leagues} />
      </div>
    </div>
  );
}
