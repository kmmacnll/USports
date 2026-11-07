'use client';

import type { CSSProperties, ReactNode } from 'react';

import { C, DISPLAY, uniColor } from './data';

export function Icon({ name, size = 20, fill = false, color, style }: {
  name: string; size?: number; fill?: boolean; color?: string; style?: CSSProperties;
}) {
  return (
    <span className="vhq-icon" aria-hidden
      style={{ fontSize: size, color, fontVariationSettings: `'FILL' ${fill ? 1 : 0}`, ...style }}>{name}</span>
  );
}

/** University mark: tinted square with the school colour as an underline. */
export function UniMark({ uni, size, radius, font, spacing = '.03em' }: {
  uni: string; size: number; radius: number; font: number; spacing?: string;
}) {
  const c = uniColor(uni);
  return (
    <span aria-hidden style={{
      width: size, height: size, flex: 'none', borderRadius: radius, background: `${c}3D`, boxShadow: `inset 0 -2px 0 ${c}`,
      display: 'grid', placeItems: 'center', font: `700 ${font}px ${DISPLAY}`, letterSpacing: spacing, color: C.text,
    }}>{uni}</span>
  );
}

export function Dot({ color, size = 6, pulse = false }: { color: string; size?: number; pulse?: boolean }) {
  return <span aria-hidden className={pulse ? 'vhq-pulse' : undefined} style={{ width: size, height: size, flex: 'none', borderRadius: size, background: color }} />;
}

/** iOS-style segmented control. */
export function Segmented<K extends string>({ items, value, onChange, height = 36, track = C.surface, font = 13, label, style }: {
  items: [K, string][]; value: K; onChange: (k: K) => void; height?: number; track?: string; font?: number; label: string; style?: CSSProperties;
}) {
  return (
    <div role="tablist" aria-label={label} style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length},1fr)`, padding: 3, borderRadius: 12, background: track, ...style }}>
      {items.map(([k, l]) => {
        const on = value === k;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onChange(k)}
            style={{ height, borderRadius: 9, display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: font, fontWeight: 700, background: on ? C.segOn : 'transparent', color: on ? C.text : C.muted, transition: 'background .2s' }}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

/** Filter chip: white when selected. */
export function Chip({ on, onClick, children, height = 34, pad = 14, font = 13 }: {
  on: boolean; onClick: () => void; children: ReactNode; height?: number; pad?: number; font?: number;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      style={{ flex: 'none', height, padding: `0 ${pad}px`, borderRadius: height / 2, fontSize: font, fontWeight: 700, background: on ? C.text : C.surface2, color: on ? C.dark : C.text2, display: 'flex', alignItems: 'center' }}>
      {children}
    </button>
  );
}

export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return <div role="group" aria-label={label} className="vhq-noscroll" style={{ display: 'flex', gap: 6, padding: '0 16px', overflowX: 'auto' }}>{children}</div>;
}

/** Rounded list container with hairline dividers between children. */
export function List({ children, style, radius = 20 }: { children: ReactNode; style?: CSSProperties; radius?: number }) {
  return <div className="vhq-list" style={{ display: 'flex', flexDirection: 'column', margin: '0 16px', borderRadius: radius, background: C.surface, overflow: 'hidden', ...style }}>{children}</div>;
}

export function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', minHeight: 34 }}>
      <h2 className="vhq-kicker" style={{ fontSize: 13, letterSpacing: '.06em' }}>{title}</h2>
      {action && <button type="button" onClick={onAction} className="vhq-link" style={{ fontSize: 13, fontWeight: 700, padding: '8px 0' }}>{action}</button>}
    </div>
  );
}

export function PrimaryButton({ enabled = true, onClick, children, height = 54, font = 16, bg, fg, style }: {
  enabled?: boolean; onClick: () => void; children: ReactNode; height?: number; font?: number; bg?: string; fg?: string; style?: CSSProperties;
}) {
  return (
    <button type="button" aria-disabled={!enabled} onClick={onClick} className="vhq-press"
      style={{ height, borderRadius: 16, background: bg ?? (enabled ? C.primary : C.surface2), color: fg ?? (enabled ? C.ink : C.faint), fontWeight: 800, fontSize: font, display: 'grid', placeItems: 'center', transition: 'background .2s', width: '100%', ...style }}>
      {children}
    </button>
  );
}

export const num = (size: number, color?: string, weight = 600, lh?: number): CSSProperties => ({
  font: `${weight} ${size}px${lh ? `/${lh}` : ''} ${DISPLAY}`, fontVariantNumeric: 'tabular-nums', color,
});
