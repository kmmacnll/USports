'use client';

import { ArrowLeftRight, GripVertical, Trash2 } from 'lucide-react';
import { useEffect, useOptimistic, useState, useTransition } from 'react';

import { dropAthlete, swapSlot } from '@/lib/actions';
import type { RosterSlot, StatColumn } from '@/lib/types';

import { PlayerPopover } from './player-popover';
import { ErrorNote } from './ui';

const keyOf = (s: RosterSlot) => `${s.slot}#${s.slot_index}`;
const isStarter = (slot: string) => slot !== 'BENCH' && slot !== 'IR';

/** Mirrors the API/DB eligibility rule so only legal targets light up. */
function eligible(slot: string, positions: string[], rules: Record<string, string[]>) {
  if (!isStarter(slot)) return true;
  const allowed = [...(rules[slot] ?? []), slot];
  return allowed.includes('*') || positions.some((p) => allowed.includes(p));
}

function applySwap(slots: RosterSlot[], from: string, to: string): RosterSlot[] {
  const a = slots.find((s) => keyOf(s) === from)?.athlete ?? null;
  const b = slots.find((s) => keyOf(s) === to)?.athlete ?? null;
  return slots.map((s) => (keyOf(s) === from ? { ...s, athlete: b } : keyOf(s) === to ? { ...s, athlete: a } : s));
}

export function RosterGrid({ leagueId, slots, eligibility, editable, columns }: {
  leagueId: string;
  slots: RosterSlot[];
  eligibility: Record<string, string[]>;
  editable: boolean;
  columns: { season: StatColumn[]; game: StatColumn[] };
}) {
  const [optimistic, apply] = useOptimistic(slots, (state, move: { from: string; to: string } | { drop: string }) =>
    'drop' in move ? state.map((s) => (keyOf(s) === move.drop ? { ...s, athlete: null } : s)) : applySwap(state, move.from, move.to));
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const from = optimistic.find((s) => keyOf(s) === selected);
  const canMoveTo = (to: RosterSlot) => {
    if (!from?.athlete || keyOf(to) === keyOf(from)) return false;
    if (!eligible(to.slot, from.athlete.positions, eligibility)) return false;
    return !to.athlete || eligible(from.slot, to.athlete.positions, eligibility);
  };

  function move(to: RosterSlot) {
    if (!from?.athlete || !canMoveTo(to)) return;
    const athleteId = from.athlete.athlete_id;
    const fromKey = keyOf(from);
    setSelected(null);
    setError(undefined);
    start(async () => {
      apply({ from: fromKey, to: keyOf(to) });
      const res = await swapSlot(leagueId, athleteId, to.slot, to.slot_index);
      if (!res.ok) setError(res.error.message);
    });
  }

  function drop(slot: RosterSlot) {
    if (!slot.athlete || !confirm(`Drop ${slot.athlete.first_name} ${slot.athlete.last_name}?`)) return;
    const athleteId = slot.athlete.athlete_id;
    setSelected(null);
    start(async () => {
      apply({ drop: keyOf(slot) });
      const res = await dropAthlete(leagueId, athleteId);
      if (!res.ok) setError(res.error.message);
    });
  }

  const starters = optimistic.filter((s) => isStarter(s.slot));
  const bench = optimistic.filter((s) => !isStarter(s.slot));
  const section = (title: string, list: RosterSlot[]) => (
    <div>
      <p className="section-title mb-2">{title} <span className="font-normal normal-case tracking-normal text-slate-500">· {list.filter((s) => s.athlete).length}/{list.length}</span></p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((s) => (
          <SlotCard key={keyOf(s)} slot={s} columns={columns} editable={editable}
            selected={selected === keyOf(s)} target={!!from && canMoveTo(s)} dimmed={!!from && !canMoveTo(s) && selected !== keyOf(s)}
            onSelect={() => setSelected(selected === keyOf(s) ? null : s.athlete ? keyOf(s) : selected)}
            onTarget={() => move(s)} onDrop={() => drop(s)}
            onDragStart={() => setSelected(keyOf(s))} onDragEnd={() => setSelected((k) => (pending ? null : k))} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {editable && (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <ArrowLeftRight className="size-3.5 text-accent" />
          Drag a player onto another slot, or tap a player and then tap a highlighted slot. Occupied slots swap.
        </p>
      )}
      {error && <ErrorNote message={error} />}
      {section('Starters', starters)}
      {section('Bench', bench)}
    </div>
  );
}

function SlotCard({ slot, columns, editable, selected, target, dimmed, onSelect, onTarget, onDrop, onDragStart, onDragEnd }: {
  slot: RosterSlot; columns: { season: StatColumn[]; game: StatColumn[] }; editable: boolean;
  selected: boolean; target: boolean; dimmed: boolean;
  onSelect: () => void; onTarget: () => void; onDrop: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const a = slot.athlete;
  const [over, setOver] = useState(false);
  const ring = selected ? 'border-accent ring-2 ring-accent/60' : target ? 'border-accent/70 ring-1 ring-accent/40' : 'border-white/10';
  return (
    <div
      onClick={() => editable && (target ? onTarget() : onSelect())}
      onDragOver={(e) => { if (target) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onTarget(); }}
      className={`group relative flex min-h-[4.5rem] items-center gap-3 rounded-xl border bg-slate-950/50 px-3 py-2.5 transition
        ${ring} ${over ? 'bg-accent/10' : ''} ${dimmed ? 'opacity-40' : ''} ${editable ? 'cursor-pointer' : ''}`}
      role={editable ? 'button' : undefined}
      aria-pressed={editable ? selected : undefined}
      aria-label={editable ? `${slot.slot} slot ${slot.slot_index}${a ? `: ${a.first_name} ${a.last_name}` : ', empty'}` : undefined}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg text-xs font-black
        ${slot.slot_type === 'STARTER' ? 'bg-accent/15 text-accent' : 'bg-white/10 text-slate-300'}`}>
        {slot.slot === 'BENCH' ? 'BN' : slot.slot}
      </span>
      {a ? (
        <>
          {editable && (
            <span draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }} onDragEnd={onDragEnd}
              className="cursor-grab text-slate-600 hover:text-slate-300 active:cursor-grabbing" aria-hidden>
              <GripVertical className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
            <PlayerPopover athleteId={a.athlete_id} columns={columns}>
              <span className="block truncate font-medium">{a.first_name} {a.last_name}</span>
            </PlayerPopover>
            <p className="truncate text-xs text-slate-500">
              {a.university} · {a.positions.length ? a.positions.join('/') : 'no position yet'}
              {a.status !== 'ACTIVE' && <span className="ml-1 text-amber-400">{a.status}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold tabular-nums text-accent">{a.season_fantasy_points.toFixed(1)}</p>
            <p className="text-[10px] uppercase text-slate-500">{a.games_played} GP</p>
          </div>
          {editable && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onDrop(); }}
              className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-slate-800 p-1 text-slate-400 shadow hover:text-rose-300 group-hover:block"
              aria-label={`Drop ${a.first_name} ${a.last_name}`}>
              <Trash2 className="size-3" />
            </button>
          )}
        </>
      ) : (
        <span className="text-sm text-slate-500">{target ? 'Move here' : 'Empty'}</span>
      )}
    </div>
  );
}
