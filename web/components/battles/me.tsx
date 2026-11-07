'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** The signed-in player as Battles shows them. Comes from the session, never made up. */
export interface BattleUser { name: string; handle: string; ini: string; bg: string; signedIn: boolean }

export function battleUser(displayName: string | null): BattleUser {
  const name = displayName?.trim() || 'You';
  const ini = displayName ? name.split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') : '?';
  return { name, handle: displayName ? name : 'You', ini, bg: 'radial-gradient(circle at 35% 30%,#2F5596,#0C1628 75%)', signedIn: !!displayName };
}

const MeCtx = createContext<BattleUser>(battleUser(null));
export const MeProvider = ({ me, children }: { me: BattleUser; children: ReactNode }) => <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
export const useMe = () => useContext(MeCtx);

// ---------- Your battle record, kept on this device until Battles has an API ----------
export type Result = 'W' | 'L';
const KEY = 'vhq.battles.record';
const EVENT = 'vhq-battles-record';

function read(): Result[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is Result => x === 'W' || x === 'L') : [];
  } catch { return []; }
}

export function recordResult(r: Result) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), r].slice(-200)));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* storage blocked: the record just isn't kept */ }
}

export interface BattleRecord { results: Result[]; played: number; wins: number; losses: number; streak: number; best: number }

/** Oldest first. Empty on the server and before the first battle. */
export function useRecord(): BattleRecord {
  const [results, setResults] = useState<Result[]>([]);
  const sync = useCallback(() => setResults(read()), []);
  useEffect(() => {
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, [sync]);
  const wins = results.filter((r) => r === 'W').length;
  let streak = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === 'W'; i--) streak++;
  let best = 0, run = 0;
  for (const r of results) { run = r === 'W' ? run + 1 : 0; best = Math.max(best, run); }
  return { results, played: results.length, wins, losses: results.length - wins, streak, best };
}
