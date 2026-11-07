'use client';

import { useEffect, useRef, useState } from 'react';

/** Seconds elapsed since mount, ticking once a second (or every `ms`). */
export function useElapsed(ms = 1000, running = true) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(iv);
  }, [ms, running]);
  return n;
}

/** Calls `fn` once after `ms`, cancelled on unmount or when deps change. */
export function useTimeout(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    if (ms === null) return;
    const t = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(t);
  }, [ms]);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
