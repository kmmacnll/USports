'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-secondary h-10 gap-2 rounded-xl px-3 text-[13px]"
      onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}
      aria-label={`Copy ${label}`}>
      <span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-ink-3">{label}</span>
      <span className="font-mono">{value}</span>
      {done ? <Check className="size-4 text-win" /> : <Copy className="size-4 text-ink-3" />}
    </button>
  );
}
