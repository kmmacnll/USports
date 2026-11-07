import { BattlesApp } from '@/components/battles/battles-app';
import { fromApi, type ApiPlayer, type Player } from '@/components/battles/data';
import { api, getMe } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Real U Sports hockey players with Draft Battles ratings. Empty until the ratings job has run. */
async function loadPool(gender: 'women' | 'men'): Promise<Player[]> {
  try {
    const res = await api<{ data: ApiPlayer[] }>('/players', { auth: false, revalidate: 300, query: { sport: 'hockey', gender, page_size: 200 } });
    return res.data.map(fromApi).filter((p): p is Player => p !== null);
  } catch {
    return [];
  }
}

export default async function BattlesPage() {
  const [me, women, men] = await Promise.all([getMe(), loadPool('women'), loadPool('men')]);
  return <BattlesApp displayName={me?.display_name ?? null} leagueCount={new Set(me?.teams.map((t) => t.league_id)).size}
    pools={{ W: women, M: men }} />;
}
