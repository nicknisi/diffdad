import type { Callout } from '../state/types';

/** Severity surfaces for callouts — shared by the inline annotation and the
 *  trailing "Review callouts" list (for callouts that match no shown hunk). */
export const CALLOUT_STYLES: Record<Callout['level'], { bg: string; border: string; color: string; label: string }> = {
  nit: { bg: 'var(--gray-2)', border: 'var(--gray-a4)', color: 'var(--fg-2)', label: 'Nit' },
  concern: { bg: 'var(--yellow-2)', border: 'var(--yellow-a4)', color: 'var(--yellow-11)', label: 'Concern' },
  warning: { bg: 'var(--red-2)', border: 'var(--red-a4)', color: 'var(--red-11)', label: 'Warning' },
};

/**
 * A passive narrative callout (nit / concern / warning) anchored INLINE in the diff,
 * directly under the line it's about. The file:line prefix the trailing list carries is
 * dropped here — the position already says where, so the message stands on its own.
 */
export function InlineCallout({ callout }: { callout: Callout }) {
  const style = CALLOUT_STYLES[callout.level];
  return (
    <div
      className="flex items-start gap-2 rounded-[8px] px-3 py-2 text-[13px] leading-[19px]"
      style={{ background: style.bg, boxShadow: `inset 0 0 0 1px ${style.border}` }}
    >
      <span
        className="mt-[1px] inline-flex flex-shrink-0 items-center rounded-full px-[6px] py-[1px] text-[10px] font-bold uppercase tracking-[0.04em]"
        style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}
      >
        {style.label}
      </span>
      <span className="flex-1 text-[var(--fg-2)]">{callout.message}</span>
    </div>
  );
}
