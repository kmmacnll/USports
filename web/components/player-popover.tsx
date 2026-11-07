'use client';

import { LoaderCircle } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';

import { loadAthlete } from '@/lib/actions';
import type { AthleteDetail, StatColumn } from '@/lib/types';

import { Sheet } from './sheet';
import { UniMark } from './ui';

const cache = new Map<string, AthleteDetail>();
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '—');

/**
 * Tap the trigger to open the player card: bio line, season tiles and the game
 * log. Data loads on first open and is cached for the session.
 * `action` renders at the bottom of the card (e.g. Add / Drop).
 */
export function PlayerPopover({ athleteId, columns, children, action, className = '' }: {
  athleteId: string;
  columns: { season: StatColumn[]; game: StatColumn[] };
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AthleteDetail | undefined>(cache.get(athleteId));
  const [error, setError] = useState<string>();
  const [, start] = useTransition();

  function show() {
    setOpen(true);
    if (data) return;
    setError(undefined);
    start(async () => {
      const res = await loadAthlete(athleteId);
      if (res.ok) { cache.set(athleteId, res.data); setData(res.data); } else setError(res.error.message);
    });
  }

  const gameCols = columns.game.slice(0, 3);
  const grid = { gridTemplateColumns: `minmax(0,1fr) ${gameCols.map(() => '42px').join(' ')} 48px` };

  return (
    <>
      <button type="button" onClick={show} className={`block max-w-full min-w-0 text-left hover:text-blue focus-visible:text-blue ${className}`}>
        {children}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Player card">
        {!data && !error && <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3"><LoaderCircle className="size-4 animate-spin" /> Loading…</div>}
        {error && <p className="py-12 text-center text-sm text-loss">{error}</p>}
        {data && (
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-3.5 sm:pr-10">
              <UniMark name={data.university} id={data.university_id} size={58} />
              <div className="min-w-0">
                <h2 className="display text-[30px] leading-[.95]">{data.first_name} {data.last_name}</h2>
                <p className="mt-1 text-[12.5px] font-semibold text-ink-3">
                  {[data.university, data.position, data.jersey_number && `#${data.jersey_number}`, data.height, data.class_year && `Year ${data.class_year}`]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <Tile label="GP" value={fmt(data.stats.games_played)} />
              <Tile label="FP/G" value={fmt(data.stats.fantasy_points_avg)} blue />
              {columns.season.slice(0, 2).map((c) => <Tile key={c.key} label={c.label} value={fmt(data.stats[c.key])} />)}
            </div>
            <div>
              <p className="section-title mb-1.5">Game log · {data.season}</p>
              {data.games.length === 0 ? (
                <p className="py-4 text-[13px] text-ink-4">No games yet this season.</p>
              ) : (
                <div role="table" aria-label="Game log" className="text-[13px] tabular-nums">
                  <div role="row" className="grid border-b border-white/[.08] py-1.5 text-[10px] font-extrabold tracking-[.06em] text-ink-4" style={grid}>
                    <span role="columnheader">GAME</span>
                    {gameCols.map((c) => <span key={c.key} role="columnheader" className="text-right">{c.label}</span>)}
                    <span role="columnheader" className="text-right text-blue">FP</span>
                  </div>
                  {data.games.map((g) => (
                    <div key={g.game_id} role="row" className="grid min-h-9 items-center border-b border-white/[.04]" style={grid}>
                      <span role="cell" className="truncate">
                        <span className="text-ink-4">{g.date.slice(5).replace('-', '/')}</span> {g.home ? 'vs' : '@'} {g.opponent}
                        {g.exhibition && <span className="ml-1 text-[10px] text-ink-4">EXH</span>}
                      </span>
                      {gameCols.map((c) => <span key={c.key} role="cell" className="text-right">{fmt(g.stats[c.key])}</span>)}
                      <span role="cell" className="text-right font-extrabold text-blue">{fmt(g.fantasy_points)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {action}
          </div>
        )}
      </Sheet>
    </>
  );
}

function Tile({ label, value, blue }: { label: string; value: string; blue?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-surface-2/80 px-1 py-2.5 ring-1 ring-blue/10">
      <span className={`num text-xl leading-none ${blue ? 'text-blue' : ''}`}>{value}</span>
      <span className="whitespace-nowrap text-[9px] font-extrabold tracking-[.04em] text-ink-4">{label}</span>
    </div>
  );
}
