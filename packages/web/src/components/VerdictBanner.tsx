import { useReviewStore } from '../state/review-store';
import { NarrationBlock } from './NarrationBlock';

const VERDICT_CONFIG = {
  safe: {
    bg: 'linear-gradient(180deg, var(--green-2), var(--green-3))',
    border: 'var(--green-a5)',
    iconBg: 'var(--green-9)',
    textColor: 'var(--green-12)',
    label: 'Safe to merge',
    icon: '✓',
  },
  caution: {
    bg: 'linear-gradient(180deg, var(--yellow-2), var(--yellow-3))',
    border: 'var(--yellow-a5)',
    iconBg: 'var(--yellow-9)',
    textColor: 'var(--yellow-12)',
    label: 'Review with care',
    icon: '⚠',
  },
  risky: {
    bg: 'linear-gradient(180deg, var(--red-2), var(--red-3))',
    border: 'var(--red-a5)',
    iconBg: 'var(--red-9)',
    textColor: 'var(--red-12)',
    label: 'Risky — needs close review',
    icon: '✗',
  },
} as const;

export function VerdictBanner() {
  const narrative = useReviewStore((s) => s.narrative);
  if (!narrative?.verdict && !narrative?.tldr) return null;

  const verdict = narrative.verdict ?? 'caution';
  const config = VERDICT_CONFIG[verdict];

  return (
    <div
      className="mb-6 flex items-start gap-2.5 rounded-[10px] px-4 py-3.5"
      style={{ background: config.bg, boxShadow: `inset 0 0 0 1px ${config.border}` }}
    >
      <div
        className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[7px] text-[14px] text-white"
        style={{ background: config.iconBg, boxShadow: '0 1px 2px rgba(3,2,13,0.10)' }}
      >
        {config.icon}
      </div>
      <div className="flex-1 text-[13.5px] leading-[19px]" style={{ color: config.textColor }}>
        <b className="font-bold">{config.label}</b>
        {narrative.tldr && (
          <div className="mt-1" style={{ color: 'var(--fg-2)' }}>
            <NarrationBlock content={narrative.tldr} />
          </div>
        )}
      </div>
    </div>
  );
}
