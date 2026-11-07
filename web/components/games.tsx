import type { Game } from '@/lib/types';

import { UniMark } from './ui';

export const isLive = (g: Game) => g.status === 'IN_PROGRESS';
export const isFinal = (g: Game) => g.status === 'FINAL';

export const shortDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

/** Live, Upcoming and Final groups, each a tile of game rows. */
export function GameGroups({ games, mine, showDate = false }: { games: Game[]; mine: Set<string>; showDate?: boolean }) {
  const groups = [
    { title: 'Live', list: games.filter(isLive) },
    { title: 'Upcoming', list: games.filter((g) => !isLive(g) && !isFinal(g)) },
    { title: 'Final', list: games.filter(isFinal).reverse() },
  ].filter((g) => g.list.length);
  return (
    <div className="space-y-5">
      {groups.map((grp) => (
        <section key={grp.title} className="space-y-2">
          <h2 className="section-title px-1">
            {grp.title === 'Live' && <span className="size-1.5 rounded-full bg-live" style={{ animation: 'vhq-pulse 1.4s infinite' }} />}
            {grp.title}
          </h2>
          <ul className="tile rows overflow-hidden">
            {grp.list.map((g) => <GameRow key={g.game_id} game={g} mine={mine} showDate={showDate} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function GameRow({ game, mine, showDate }: { game: Game; mine: Set<string>; showDate?: boolean }) {
  const final = isFinal(game), live = isLive(game);
  const side = (t: Game['home'], other: Game['home']) => {
    const won = final && (t.score ?? 0) > (other.score ?? 0);
    const lost = final && (t.score ?? 0) < (other.score ?? 0);
    return (
      <div className="flex items-center gap-2.5">
        <UniMark name={t.name} id={t.university_id} size={28} />
        <span className={`min-w-0 flex-1 truncate text-[14px] ${won ? 'font-extrabold' : 'font-semibold'} ${lost ? 'text-ink-3' : ''}`}>{t.name}</span>
        {mine.has(t.name) && <span className="size-1.5 flex-none rounded-full bg-primary" title="Your starter plays for this team" />}
        <span className={`num w-9 text-right text-[20px] ${lost ? 'text-ink-3' : ''}`}>{t.score ?? ''}</span>
      </div>
    );
  };
  const status = final ? 'Final' : live ? 'Live' : game.status === 'SCHEDULED' ? shortDate(game.date).split(',')[0] : titleCase(game.status);
  return (
    <li className="grid grid-cols-[1fr_84px] items-stretch px-4 py-3">
      <div className="space-y-2">
        {side(game.away, game.home)}
        {side(game.home, game.away)}
      </div>
      <div className="flex flex-col items-end justify-center gap-0.5 border-l border-white/[.07]">
        <span className={`text-[12px] font-extrabold ${live ? 'text-live' : final ? 'text-ink-3' : 'text-ink'}`}>{status}</span>
        <span className="text-[10.5px] font-semibold text-ink-4">{showDate || !final ? shortDate(game.date).replace(/^\w+, /, '') : ''}</span>
        {(game.playoff || game.exhibition) && (
          <span className={`mt-0.5 text-[9.5px] font-extrabold tracking-[.06em] ${game.playoff ? 'text-gold' : 'text-ink-4'}`}>{game.playoff ? 'PLAYOFF' : 'EXH'}</span>
        )}
      </div>
    </li>
  );
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
