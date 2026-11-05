'use client';

import { LoaderCircle, Plus, Search } from 'lucide-react';
import { useState, useTransition } from 'react';

import { addAthlete, searchAvailable } from '@/lib/actions';
import type { Athlete, StatColumn } from '@/lib/types';

import { PlayerPopover } from './player-popover';
import { ErrorNote, fmt } from './ui';

export function AddPlayers({ leagueId, positions, columns, rosterFull }: {
  leagueId: string; positions: string[]; columns: { season: StatColumn[]; game: StatColumn[] }; rosterFull: boolean;
}) {
  const [q, setQ] = useState('');
  const [position, setPosition] = useState('');
  const [results, setResults] = useState<Athlete[] | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function search(e?: React.FormEvent) {
    e?.preventDefault();
    setError(undefined);
    start(async () => {
      const res = await searchAvailable(leagueId, q, position);
      if (res.ok) setResults(res.data.data);
      else setError(res.error.message);
    });
  }

  function add(a: Athlete) {
    setError(undefined);
    start(async () => {
      const res = await addAthlete(leagueId, a.athlete_id);
      if (res.ok) setResults((r) => r?.filter((x) => x.athlete_id !== a.athlete_id) ?? null);
      else setError(res.error.message);
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9" placeholder="Search available players" />
        </div>
        <select value={position} onChange={(e) => setPosition(e.target.value)} className="input w-24" aria-label="Position">
          <option value="">Any</option>
          {positions.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className="btn-primary" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : 'Search'}</button>
      </form>
      {rosterFull && <p className="text-xs text-amber-300">Your roster is full; drop a player to add another.</p>}
      {error && <ErrorNote message={error} />}
      {results && (results.length === 0 ? (
        <p className="text-sm text-slate-500">No available players match.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {results.map((a) => (
            <li key={a.athlete_id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <PlayerPopover athleteId={a.athlete_id} columns={columns}>
                  <span className="font-medium">{a.first_name} {a.last_name}</span>
                </PlayerPopover>
                <p className="truncate text-xs text-slate-500">{a.university} · {a.positions.join('/') || 'no position yet'} · {a.stats.games_played} GP</p>
              </div>
              <span className="text-sm font-bold tabular-nums text-accent">{fmt(a.stats.fantasy_points_avg)}</span>
              <button onClick={() => add(a)} disabled={pending || rosterFull} className="btn-ghost px-2" aria-label={`Add ${a.first_name} ${a.last_name}`}>
                <Plus className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
