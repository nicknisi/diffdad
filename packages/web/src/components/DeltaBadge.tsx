import type { ConcernStatus } from '../state/types';

const STYLES: Record<Exclude<ConcernStatus, 'unfixed'>, { bg: string; color: string; label: string }> = {
  fixed: { bg: 'var(--green-3)', color: 'var(--green-11)', label: 'Fixed' },
  new: { bg: 'var(--blue-3)', color: 'var(--blue-11)', label: 'New' },
};

export function DeltaBadge({ status }: { status: ConcernStatus | undefined }) {
  if (!status || status === 'unfixed') return null;
  const s = STYLES[status];
  return (
    <span
      className="inline-flex flex-shrink-0 items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}
