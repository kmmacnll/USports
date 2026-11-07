'use client';

import { Check, LoaderCircle, Plus, Search } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { addAthlete, searchAvailable } from '@/lib/actions';
import type { Athlete, StatColumn } from '@/lib/types';

import { PlayerPopover } from './player-popover';
import { Empty, ErrorNote, UniMark, chipClass, fmt } from './ui';

export function AddPlayers({ leagueId, positions, columns, rosterFull, filled, size }: {
  leagueId: string; positions: string[]; columns: { season: StatColumn[]; game: StatColumn[] }; rosterFull: boolean; filled: number; size: number;
}) {
  const [q, setQ] = useState('');
  const [position, setPosition] = useState('');
  const [results, setResults] = useState<Athlete[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const full = rosterFull || filled + added.length >= size;

  function search(query = q, pos = position) {
    setError(undefined);
    start(async () => {
      const res = await searchAvailable(leagueId, query, pos);
      if (res.ok) setResults(res.data.data);
      else setError(res.error.message);
    });
  }
  // Show the best available players straight away.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => search('', ''), []);

  function add(a: Athlete) {
    setError(undefined);
    start(async () => {
      const res = await addAthlete(leagueId, a.athlete_id);
      if (res.ok) setAdded((x) => [...x, a.athlete_id]);
      else setError(res.error.message);
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-ink-4" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="input pl-11" placeholder="Search free agents" aria-label="Search free agents" />
        </label>
        <button className="btn-primary h-12 w-12 flex-none px-0" disabled={pending} aria-label="Search">
          {pending ? <LoaderCircle className="size-5 animate-spin" /> : <Search className="size-5" />}
        </button>
      </form>
      {positions.length > 1 && (
        <div role="group" aria-label="Position" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {['', ...positions].map((p) => (
            <button key={p || 'any'} type="button" aria-pressed={position === p} className={chipClass(position === p)}
              onClick={() => { setPosition(p); search(q, p); }}>{p || 'All'}</button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between px-1 text-[11px] font-extrabold tracking-[.08em] text-ink-4">
        <span className={full ? 'text-gold' : ''}>ROSTER {filled + added.length}/{size}{full ? ' · FULL, DROP SOMEONE FIRST' : ''}</span>
        <span>FP/G</span>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="tile rows overflow-hidden">
        {results === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3"><LoaderCircle className="size-4 animate-spin" /> Loading…</div>
        ) : results.length === 0 ? (
          <Empty>No free agents match.</Empty>
        ) : results.map((a) => {
          const done = added.includes(a.athlete_id);
          return (
            <div key={a.athlete_id} className="flex min-h-[64px] items-center gap-3 py-2 pl-4 pr-2.5">
              <PlayerPopover athleteId={a.athlete_id} columns={columns} className="flex min-w-0 flex-1 items-center gap-3">
                <UniMark name={a.university} id={a.university_id} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold">{a.first_name} {a.last_name}</span>
                  <span className="block truncate text-xs font-semibold text-ink-3">{a.positions.join('/') || 'no position'} · {a.university} · {a.stats.games_played} GP</span>
                </span>
                <span className="num text-[20px] text-blue">{fmt(a.stats.fantasy_points_avg)}</span>
              </PlayerPopover>
              <button onClick={() => add(a)} disabled={pending || full || done} aria-label={done ? `${a.first_name} ${a.last_name} added` : `Add ${a.first_name} ${a.last_name}`}
                className={`grid size-11 flex-none place-items-center rounded-full transition disabled:cursor-not-allowed ${done ? 'bg-primary/15 text-primary-text' : full ? 'bg-surface-2 text-ink-4' : 'bg-win/15 text-win hover:bg-win/25'}`}>
                {done ? <Check className="size-5" /> : <Plus className="size-5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
