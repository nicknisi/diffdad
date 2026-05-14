import { useReviewStore } from '../state/review-store';
import type { Chapter } from '../state/types';

const RISK_LEVELS: Chapter['risk'][] = ['high', 'medium', 'low'];

const RISK_STYLES: Record<Chapter['risk'], { bg: string; color: string; label: string }> = {
  low: { bg: 'var(--gray-3)', color: 'var(--fg-2)', label: 'Low' },
  medium: { bg: 'var(--yellow-3)', color: 'var(--yellow-11)', label: 'Medium' },
  high: { bg: 'var(--red-3)', color: 'var(--red-11)', label: 'High' },
};

export function RiskFilterBar() {
  const narrative = useReviewStore((s) => s.narrative);
  const selectedRiskLevels = useReviewStore((s) => s.selectedRiskLevels);
  const toggleRiskLevel = useReviewStore((s) => s.toggleRiskLevel);

  if (!narrative) return null;

  const counts = new Map<Chapter['risk'], number>();
  for (const ch of narrative.chapters) {
    counts.set(ch.risk, (counts.get(ch.risk) ?? 0) + 1);
  }

  if (narrative.chapters.length === 0) return null;

  const allSelected = selectedRiskLevels.size === 3;
  const noneSelected = selectedRiskLevels.size === 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Risk</span>
      {RISK_LEVELS.map((risk) => {
        const count = counts.get(risk) ?? 0;
        if (count === 0) return null;
        const active = allSelected || noneSelected || selectedRiskLevels.has(risk);
        const style = RISK_STYLES[risk];
        return (
          <button
            key={risk}
            type="button"
            onClick={() => toggleRiskLevel(risk)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] transition-opacity"
            style={{
              background: active ? style.bg : 'var(--gray-3)',
              color: active ? style.color : 'var(--fg-3)',
              opacity: active ? 1 : 0.4,
            }}
          >
            {style.label}
            <span className="ml-0.5 text-[9.5px] opacity-70">{count}</span>
          </button>
        );
      })}
      {noneSelected && (
        <span className="ml-2 text-[11px] text-[var(--fg-3)]">
          All chapters hidden — click a risk level to show them
        </span>
      )}
    </div>
  );
}
