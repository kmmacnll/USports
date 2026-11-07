'use client';

import { ArrowUpDown, IdCard, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useOptimistic, useState, useTransition } from 'react';

import { dropAthlete, swapSlot } from '@/lib/actions';
import type { RosterSlot, StatColumn } from '@/lib/types';

import { PlayerPopover } from './player-popover';
import { ErrorNote } from './ui';

const keyOf = (s: RosterSlot) => `${s.slot}#${s.slot_index}`;
const isStarter = (slot: string) => slot !== 'BENCH' && slot !== 'IR';
const slotLabel = (slot: string) => (slot === 'BENCH' ? 'BN' : slot === 'FLEX' ? 'FLX' : slot);

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

export function RosterGrid({ leagueId, slots, eligibility, editable, columns, addHref }: {
  leagueId: string;
  slots: RosterSlot[];
  eligibility: Record<string, string[]>;
  editable: boolean;
  columns: { season: StatColumn[]; game: StatColumn[] };
  addHref?: string;
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
    setError(undefined);
    start(async () => {
      apply({ drop: keyOf(slot) });
      const res = await dropAthlete(leagueId, athleteId);
      if (!res.ok) setError(res.error.message);
    });
  }

  function tap(s: RosterSlot) {
    if (from && canMoveTo(s)) return move(s);
    if (selected === keyOf(s)) return setSelected(null);
    if (s.athlete) setSelected(keyOf(s));
  }

  const starters = optimistic.filter((s) => isStarter(s.slot));
  const bench = optimistic.filter((s) => !isStarter(s.slot));
  const section = (title: string, list: RosterSlot[]) => (
    <section className="space-y-2">
      <h2 className="section-title px-1">{title} <span className="font-semibold normal-case tracking-normal text-ink-4">· {list.filter((s) => s.athlete).length}/{list.length}</span></h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((s) => {
          const k = keyOf(s), sel = selected === k, target = !!from && canMoveTo(s);
          return (
            <SlotCard key={k} slot={s} columns={columns} editable={editable} addHref={addHref}
              selected={sel} target={target} dimmed={!!from && !target && !sel}
              onTap={() => tap(s)}
              onDragStart={() => setSelected(k)} onDragEnd={() => setSelected((x) => (pending ? null : x))} onDropHere={() => move(s)} />
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      {editable && (
        <div aria-live="polite" className={`sticky top-[64px] z-20 flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 py-2 text-[13px] font-bold backdrop-blur-xl transition
          ${from?.athlete ? 'bg-[#3A1820]/90 text-primary-text ring-1 ring-primary/50' : 'bg-surface/85 text-ink-3 ring-1 ring-blue/15'}`}>
          <ArrowUpDown className="size-[18px] flex-none" />
          {from?.athlete ? (
            <>
              <span className="min-w-0 flex-1 truncate">Move {from.athlete.first_name[0]}. {from.athlete.last_name}: tap a highlighted slot</span>
              <PlayerPopover athleteId={from.athlete.athlete_id} columns={columns} className="grid size-9 flex-none place-items-center rounded-full bg-white/10 text-ink">
                <IdCard className="size-[18px]" aria-label="Player card" />
              </PlayerPopover>
              <button type="button" onClick={() => drop(from)} aria-label={`Drop ${from.athlete.first_name} ${from.athlete.last_name}`}
                className="grid size-9 flex-none place-items-center rounded-full bg-loss/15 text-loss"><Trash2 className="size-[17px]" /></button>
              <button type="button" onClick={() => setSelected(null)} aria-label="Cancel" className="grid size-9 flex-none place-items-center rounded-full text-ink-3"><X className="size-[18px]" /></button>
            </>
          ) : (
            <span className="flex-1">Tap a player, then a highlighted slot to swap</span>
          )}
        </div>
      )}
      {error && <ErrorNote message={error} />}
      {section('Starters', starters)}
      {section('Bench', bench)}
    </div>
  );
}

function SlotCard({ slot, columns, editable, addHref, selected, target, dimmed, onTap, onDragStart, onDragEnd, onDropHere }: {
  slot: RosterSlot; columns: { season: StatColumn[]; game: StatColumn[] }; editable: boolean; addHref?: string;
  selected: boolean; target: boolean; dimmed: boolean;
  onTap: () => void; onDragStart: () => void; onDragEnd: () => void; onDropHere: () => void;
}) {
  const a = slot.athlete;
  const [over, setOver] = useState(false);
  const starter = slot.slot_type === 'STARTER';
  const ring = selected ? 'ring-2 ring-primary shadow-[0_0_24px_rgba(217,58,64,.3)]' : target ? 'ring-[1.5px] ring-primary/60' : 'ring-1 ring-blue/15';

  const body = (
    <>
      <span className={`num grid size-11 flex-none place-items-center rounded-xl text-[14px] tracking-[.04em] ${starter ? 'bg-primary/15 text-primary-text' : 'bg-navy text-ink-3'}`}>
        {slotLabel(slot.slot)}
      </span>
      {a ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-extrabold">{a.first_name} {a.last_name}</span>
            <span className="block truncate text-xs font-semibold text-ink-3">
              {a.university} · {a.positions.length ? a.positions.join('/') : 'no position'}
              {a.status !== 'ACTIVE' && <span className="ml-1 text-gold">{a.status}</span>}
            </span>
          </span>
          <span className="flex flex-none flex-col items-end leading-none">
            <span className="num text-[20px] text-blue">{a.season_fantasy_points.toFixed(1)}</span>
            <span className="mt-1 text-[10px] font-bold text-ink-4">{a.games_played} GP</span>
          </span>
        </>
      ) : (
        <span className="flex-1">
          <span className={`block text-[14.5px] font-bold ${target ? 'text-primary-text' : 'text-ink-4'}`}>{target ? 'Move here' : 'Empty'}</span>
          {!target && editable && addHref && <span className="block text-xs font-semibold text-ink-4">Add from Players</span>}
        </span>
      )}
    </>
  );
  const cls = `flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-surface/90 py-2.5 pl-2.5 pr-3.5 text-left transition ${ring} ${over ? 'bg-primary/10' : ''} ${dimmed ? 'opacity-40' : ''}`;

  if (!editable) {
    return a ? <PlayerPopover athleteId={a.athlete_id} columns={columns} className={cls}>{body}</PlayerPopover> : <div className={cls}>{body}</div>;
  }
  if (!a && !target && addHref) return <Link href={addHref} className={cls}>{body}</Link>;
  return (
    <button type="button" onClick={onTap} draggable={!!a}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }} onDragEnd={onDragEnd}
      onDragOver={(e) => { if (target) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropHere(); }}
      aria-pressed={selected}
      aria-label={`${slotLabel(slot.slot)}${a ? `: ${a.first_name} ${a.last_name}` : ', empty'}${target ? ', move here' : ''}`}
      className={`${cls} press`}>
      {body}
    </button>
  );
}
