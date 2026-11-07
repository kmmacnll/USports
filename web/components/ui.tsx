import type { ReactNode } from 'react';

/** A glowing tile with an optional section header. `flush` drops the padding for edge-to-edge rows. */
export function Card({ title, icon, action, children, className = '', tone = 'tile', flush = false, id }: {
  title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
  tone?: 'tile' | 'tile-primary' | 'tile-blue' | 'tile-gold' | 'tile-live'; flush?: boolean; id?: string;
}) {
  return (
    <section id={id} className={`${tone} ${flush ? 'overflow-hidden' : 'p-4 sm:p-5'} ${className}`}>
      {(title || action) && (
        <div className={`flex min-h-6 items-center justify-between gap-3 ${flush ? 'px-4 pb-1 pt-4 sm:px-5' : 'mb-3'}`}>
          {title && <h2 className="section-title">{icon}{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Filter chip: white when selected. */
export const chipClass = (on: boolean) =>
  `inline-flex h-9 flex-none items-center rounded-full px-3.5 text-[13px] font-bold transition ${on ? 'bg-ink text-bg' : 'bg-surface-2/90 text-ink-2 ring-1 ring-blue/15 hover:text-ink'}`;

/** Section label above a list, outside any card (Battles/iOS style). */
export function SectionHead({ title, action, id }: { title: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex min-h-8 scroll-mt-20 items-center justify-between gap-3 px-1">
      <h2 className="section-title">{title}</h2>
      {action}
    </div>
  );
}

export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="display truncate text-[40px] leading-[.9] sm:text-5xl">{children}</h1>
        {sub && <p className="mt-1.5 text-[13px] font-semibold text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-[13px] font-semibold text-ink-3">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-loss/30 bg-loss/10 px-3 py-2 text-[13px] font-semibold text-loss">{message}</p>;
}

export const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(digits);

export const SPORT_SHORT: Record<string, string> = {
  usports_mbk: 'MBB', usports_wbk: 'WBB', usports_fb: 'FB', usports_mhk: 'MHK', usports_whk: 'WHK',
  usports_mvb: 'MVB', usports_wvb: 'WVB', usports_msoc: 'MSOC', usports_wsoc: 'WSOC',
};
const SPORT_LONG: Record<string, string> = {
  usports_mbk: 'M BBALL', usports_wbk: 'W BBALL', usports_fb: 'FOOTBALL', usports_mhk: 'M HOCKEY', usports_whk: 'W HOCKEY',
  usports_mvb: 'M VOLLEY', usports_wvb: 'W VOLLEY', usports_msoc: 'M SOCCER', usports_wsoc: 'W SOCCER',
};

export function SportBadge({ sport, name }: { sport: string; name?: string }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-full bg-blue/15 px-2 text-[10px] font-extrabold tracking-[.08em] text-[#C9DAFB]" title={name}>
      {SPORT_LONG[sport] ?? sport.replace('usports_', '').toUpperCase()}
    </span>
  );
}

/** Square sport mark for list rows (e.g. a league). */
export function SportMark({ sport, size = 44 }: { sport: string; size?: number }) {
  return (
    <span aria-hidden className="num grid flex-none place-items-center rounded-xl bg-navy text-[13px] tracking-[.04em] text-ink-2"
      style={{ width: size, height: size, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), inset 0 -2px 0 #2F5596' }}>
      {SPORT_SHORT[sport] ?? '•'}
    </span>
  );
}

// ---------- University marks ----------
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const clean = (name: string) => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^(Université|University)( de| of)?\s+/i, '').trim();

/** Short code for a university: "UBC" stays, "Laval" → LAV, "Queen's" → QUE. */
export function uniCode(name: string) {
  const n = clean(name);
  if (/^[A-Z]{2,4}$/.test(n)) return n;
  const words = n.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => /^[A-Z]/.test(w)) && words.length <= 3 && n.length > 12)
    return words.map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? n).replace(/[^\p{L}]/gu, '').slice(0, 3).toUpperCase();
}
const UNI_TINTS = ['#C8102E', '#2F6FC0', '#6E3FC0', '#2A7F4F', '#D0402B', '#8E2434', '#A87A26', '#3567B0', '#B3263A', '#5E3A99', '#2D7A45', '#1E5AA8'];
export const uniTint = (key: string) => UNI_TINTS[hash(key) % UNI_TINTS.length]!;

export function UniMark({ name, id, size = 36 }: { name: string; id?: string; size?: number }) {
  const c = uniTint(id ?? name);
  const code = uniCode(name);
  return (
    <span aria-hidden className="num grid flex-none place-items-center text-ink"
      style={{ width: size, height: size, borderRadius: size * 0.28, background: `${c}40`, boxShadow: `inset 0 -2px 0 ${c}`,
        fontSize: size * (code.length > 3 ? 0.29 : 0.33), letterSpacing: '.03em' }}>
      {code}
    </span>
  );
}

/** Big Barlow number with a small caption under it. */
export function Stat({ value, label, tone = 'text-ink', size = 'text-xl' }: { value: ReactNode; label: ReactNode; tone?: string; size?: string }) {
  return (
    <span className="flex flex-col items-end leading-none">
      <span className={`num ${size} ${tone}`}>{value}</span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-[.06em] text-ink-4">{label}</span>
    </span>
  );
}
