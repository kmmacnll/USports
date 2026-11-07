import { BattlesApp } from '@/components/battles/battles-app';
import { fromApi, type ApiPlayer, type Player } from '@/components/battles/data';
import { api, getMe } from '@/lib/api';

import './battles.css';

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

/** The whole site is Draft Battles: full-bleed below the 56px header, a phone-width column on larger screens. */
export default async function HomePage() {
  const [me, women, men] = await Promise.all([getMe(), loadPool('women'), loadPool('men')]);
  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-30 bg-[#05080F]">
      <div className="mx-auto h-full w-full max-w-[430px] sm:border-x sm:border-white/10">
        <BattlesApp displayName={me?.display_name ?? null} pools={{ W: women, M: men }} />
      </div>
    </div>
  );
}
