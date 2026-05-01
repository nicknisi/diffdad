import { useReviewStore } from '../state/review-store';
import { NarrationBlock } from './NarrationBlock';

const VERDICT_CONFIG = {
  safe: {
    bg: 'color-mix(in srgb, var(--green-9) 8%, var(--bg-panel))',
    border: 'var(--green-a5)',
    accent: 'var(--green-9)',
    iconBg: 'var(--green-9)',
    textColor: 'var(--green-11)',
    label: 'Safe to merge',
    icon: '✓',
  },
  caution: {
    bg: 'color-mix(in srgb, var(--yellow-9) 12%, var(--bg-panel))',
    border: 'var(--yellow-a6)',
    accent: 'var(--yellow-9)',
    iconBg: 'var(--yellow-9)',
    textColor: 'var(--yellow-11)',
    label: 'Review with care',
    icon: '⚠',
  },
  risky: {
    bg: 'color-mix(in srgb, var(--red-9) 12%, var(--bg-panel))',
    border: 'var(--red-a6)',
    accent: 'var(--red-9)',
    iconBg: 'var(--red-9)',
    textColor: 'var(--red-11)',
    label: 'Risky — needs close review',
    icon: '✗',
  },
} as const;

export function VerdictBanner() {
  const narrative = useReviewStore((s) => s.narrative);
  if (!narrative?.verdict && !narrative?.tldr) return null;

  const verdict = narrative.verdict ?? 'caution';
  const config = VERDICT_CONFIG[verdict];
  const needsAttention = verdict !== 'safe';

  return (
    <div
      className="mb-6 rounded-[10px] px-4 py-3.5"
      style={{
        background: config.bg,
        boxShadow: `inset 0 0 0 1px ${config.border}`,
        borderLeft: needsAttention ? `3px solid ${config.accent}` : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[16px]" style={{ color: config.textColor }}>
          {config.icon}
        </span>
        <b className="text-[15px] font-bold" style={{ color: config.textColor }}>
          {config.label}
        </b>
      </div>
      {narrative.tldr && (
        <div className="mt-1.5 text-[14px] leading-[21px]" style={{ color: 'var(--fg-1)' }}>
          <NarrationBlock content={narrative.tldr} />
        </div>
      )}
    </div>
  );
}
