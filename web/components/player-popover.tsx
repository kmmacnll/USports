'use client';

import { LoaderCircle, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';

import { loadAthlete } from '@/lib/actions';
import type { AthleteDetail, StatColumn } from '@/lib/types';

const cache = new Map<string, AthleteDetail>();
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '—');

/**
 * Click the trigger to see an athlete's season line and recent games.
 * Data loads on first open and is cached for the session.
 */
export function PlayerPopover({ athleteId, columns, children, align = 'left' }: {
  athleteId: string;
  columns: { season: StatColumn[]; game: StatColumn[] };
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AthleteDetail | undefined>(cache.get(athleteId));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [pos, setPos] = useState<{ top: number; left: number }>();

  // Rendered in a portal on <body>: glass cards (backdrop-filter) create
  // stacking contexts that would otherwise clip the panel under later cards.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(352, window.innerWidth - 16);
      const left = align === 'right' ? r.right - width : r.left;
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data) {
      start(async () => {
        const res = await loadAthlete(athleteId);
        if (res.ok) {
          cache.set(athleteId, res.data);
          setData(res.data);
        } else setError(res.error.message);
      });
    }
  }

  return (
    <span ref={ref} className="relative inline-block max-w-full align-top">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}
        className="block max-w-full text-left hover:text-accent focus-visible:text-accent">
        {children}
      </button>
      {open && pos && createPortal(
        <div id={panelId} ref={panel} role="dialog" style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          className="glass-strong fixed z-[100] w-[22rem] max-w-[calc(100vw-1rem)] bg-slate-800/95 p-4 text-left">
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 text-slate-400 hover:text-white" aria-label="Close">
            <X className="size-4" />
          </button>
          {!data && !error && (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-400"><LoaderCircle className="size-4 animate-spin" /> Loading…</div>
          )}
          {error && <p className="py-4 text-sm text-rose-300">{error}</p>}
          {data && (
            <div className="space-y-3">
              <div>
                <p className="pr-6 font-semibold">{data.first_name} {data.last_name}</p>
                <p className="text-xs text-slate-400">
                  {data.university}{data.conference ? ` · ${data.conference}` : ''}
                  {data.position ? ` · ${data.position}` : ''}{data.jersey_number ? ` · #${data.jersey_number}` : ''}
                  {data.height ? ` · ${data.height}` : ''}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <Stat label="GP" value={data.stats.games_played} />
                <Stat label="FP/G" value={data.stats.fantasy_points_avg} accent />
                {columns.season.slice(0, 2).map((c) => <Stat key={c.key} label={c.label} value={data.stats[c.key]} />)}
              </div>
              <div>
                <p className="label">Recent games · {data.season}</p>
                {data.games.length === 0 ? (
                  <p className="text-xs text-slate-500">No games yet this season.</p>
                ) : (
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full text-xs tabular-nums">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1 text-left font-medium">Game</th>
                          {columns.game.slice(0, 4).map((c) => <th key={c.key} className="px-1 text-right font-medium">{c.label}</th>)}
                          <th className="pl-1 text-right font-medium text-accent">FP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.games.map((g) => (
                          <tr key={g.game_id} className="border-t border-white/5">
                            <td className="py-1 pr-1">
                              <span className="text-slate-400">{g.date.slice(5)}</span> {g.home ? 'vs' : '@'} {g.opponent}
                              {g.exhibition && <span className="ml-1 text-[10px] text-slate-500">EXH</span>}
                            </td>
                            {columns.game.slice(0, 4).map((c) => <td key={c.key} className="px-1 text-right">{fmt(g.stats[c.key])}</td>)}
                            <td className="pl-1 text-right font-semibold text-accent">{fmt(g.fantasy_points)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          {pending && data && <LoaderCircle className="absolute bottom-3 right-3 size-3 animate-spin text-slate-500" />}
        </div>,
        document.body,
      )}
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | null | undefined; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-white/5 px-1 py-1.5">
      <p className={`text-sm font-bold tabular-nums ${accent ? 'text-accent' : ''}`}>{fmt(value)}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
