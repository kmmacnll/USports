import { BattlesApp } from '@/components/battles/battles-app';
import { getMe } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function BattlesPage() {
  const me = await getMe();
  return <BattlesApp displayName={me?.display_name ?? null} leagueCount={new Set(me?.teams.map((t) => t.league_id)).size} />;
}
