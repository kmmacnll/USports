'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost px-2 py-1 font-mono text-xs"
      onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}
      aria-label={`Copy ${label}`}>
      {value} {done ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
    </button>
  );
}
