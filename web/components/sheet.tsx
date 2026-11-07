'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet on phones, centred dialog from `sm` up. Escape and the backdrop
 * close it; focus moves in on open and back to the trigger on close.
 */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/60" style={{ animation: 'vhq-fade .2s ease' }} onClick={onClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
        className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] border-t border-blue/25 px-5 pt-2 outline-none no-scrollbar sm:max-w-md sm:rounded-[24px] sm:border sm:pt-5 sheet-in"
        style={{ background: 'linear-gradient(170deg,#16233D,#0C1628 60%)', paddingBottom: 'max(env(safe-area-inset-bottom), 28px)', boxShadow: '0 -20px 50px rgba(0,0,0,.5)' }}>
        <div aria-hidden className="mx-auto mb-3 h-[5px] w-[38px] rounded-full bg-[#2C3A57] sm:hidden" />
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 hidden size-9 place-items-center rounded-full text-ink-3 hover:bg-white/5 hover:text-ink sm:grid">
          <X className="size-5" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** iOS-style segmented control. */
export function Segmented<K extends string>({ items, value, onChange, label, className = '' }: {
  items: [K, ReactNode][]; value: K; onChange: (k: K) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`grid rounded-2xl bg-bg/70 p-1 ring-1 ring-blue/15 ${className}`} style={{ gridTemplateColumns: `repeat(${items.length},1fr)` }}>
      {items.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`h-9 rounded-xl text-[13px] font-extrabold transition ${value === k ? 'bg-navy text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.1),inset_0_0_0_1px_rgba(142,177,245,.3)]' : 'text-ink-3 hover:text-ink'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
