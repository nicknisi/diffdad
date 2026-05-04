import { useReviewStore } from '../state/review-store';
import type { Concern, ConcernCategory } from '../state/types';
import { IconChat } from './Icons';

const CATEGORY_LABELS: Record<ConcernCategory, string> = {
  logic: 'Logic',
  state: 'State',
  timing: 'Timing',
  validation: 'Validation',
  security: 'Security',
  'test-gap': 'Test gap',
  'api-contract': 'API contract',
  'error-handling': 'Error handling',
};

const CATEGORY_STYLES: Record<ConcernCategory, { bg: string; color: string }> = {
  logic: { bg: 'var(--blue-3)', color: 'var(--blue-11)' },
  state: { bg: 'var(--purple-3)', color: 'var(--purple-11)' },
  timing: { bg: 'var(--cyan-3)', color: 'var(--cyan-11)' },
  validation: { bg: 'var(--amber-3)', color: 'var(--amber-11)' },
  security: { bg: 'var(--red-3)', color: 'var(--red-11)' },
  'test-gap': { bg: 'var(--yellow-3)', color: 'var(--yellow-11)' },
  'api-contract': { bg: 'var(--violet-3)', color: 'var(--violet-11)' },
  'error-handling': { bg: 'var(--orange-3)', color: 'var(--orange-11)' },
};

function CategoryBadge({ category }: { category: ConcernCategory }) {
  const label = CATEGORY_LABELS[category] ?? category;
  const style = CATEGORY_STYLES[category] ?? { bg: 'var(--gray-3)', color: 'var(--fg-2)' };
  return (
    <span
      className="inline-flex flex-shrink-0 items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
      style={{ background: style.bg, color: style.color }}
    >
      {label}
    </span>
  );
}

function ConcernRow({ concern }: { concern: Concern }) {
  return (
    <li
      className="flex flex-col gap-1.5 rounded-[8px] px-3.5 py-3"
      style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge category={concern.category} />
        <span className="font-mono text-[11.5px] text-[var(--fg-3)]">
          {concern.file}:{concern.line}
        </span>
      </div>
      <div className="text-[14px] font-medium leading-[20px] text-[var(--fg-1)]">{concern.question}</div>
      {concern.why ? <div className="text-[12.5px] leading-[18px] text-[var(--fg-3)]">{concern.why}</div> : null}
    </li>
  );
}

export function ConcernsList() {
  const narrative = useReviewStore((s) => s.narrative);
  const concerns = narrative?.concerns ?? [];
  if (concerns.length === 0) return null;

  return (
    <section className="mb-[28px]">
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px]"
          style={{ background: 'var(--amber-3)', color: 'var(--amber-11)' }}
        >
          <IconChat className="h-[12px] w-[12px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">Things to check</h2>
          <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">
            {concerns.length} {concerns.length === 1 ? 'question' : 'questions'} a careful reviewer would ask
          </p>
        </div>
      </div>
      <ul className="ml-[34px] list-none space-y-2 p-0">
        {concerns.map((concern, i) => (
          <ConcernRow key={i} concern={concern} />
        ))}
      </ul>
    </section>
  );
}
