import type { ReactNode } from 'react';

export function Card({ title, icon, action, children, className = '' }: {
  title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`glass p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="section-title">{icon}{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{message}</p>;
}

export const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(digits);

export function SportBadge({ sport, name }: { sport: string; name?: string }) {
  const short: Record<string, string> = { usports_mbk: "M BBALL", usports_wbk: "W BBALL", usports_fb: 'FOOTBALL' };
  return (
    <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent" title={name}>
      {short[sport] ?? sport.replace('usports_', '').toUpperCase()}
    </span>
  );
}
