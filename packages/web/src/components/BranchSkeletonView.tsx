import { useReviewStore } from '../state/review-store';
import type { BranchSkeleton, SkeletonFileCategory } from '../state/types';

const CATEGORY_LABELS: Record<SkeletonFileCategory, string> = {
  test: 'Tests',
  config: 'Config',
  schema: 'Schema',
  migration: 'Migrations',
  docs: 'Docs',
  'public-api': 'Public API',
  source: 'Source',
};

const CATEGORY_ORDER: SkeletonFileCategory[] = [
  'source',
  'test',
  'public-api',
  'schema',
  'migration',
  'config',
  'docs',
];

export function BranchSkeletonView({ message }: { message: string }) {
  const watch = useReviewStore((s) => s.watch);
  if (!watch) return null;
  const { skeleton } = watch;
  return (
    <section className="px-6 py-6 text-[var(--fg-1)]">
      <header className="mb-4">
        <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--fg-3)]">Branch skeleton</p>
        <p className="mt-1 text-[15px] text-[var(--fg-2)]">{message}</p>
      </header>

      <Totals skeleton={skeleton} />
      <Categories skeleton={skeleton} />
      <TouchedDirs skeleton={skeleton} />
      <Notable skeleton={skeleton} />
    </section>
  );
}

function Totals({ skeleton }: { skeleton: BranchSkeleton }) {
  const { totals } = skeleton;
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[14px]">
      <span className="font-medium" style={{ color: 'var(--green-11)' }}>+{totals.additions}</span>
      <span className="font-medium" style={{ color: 'var(--red-11)' }}>−{totals.deletions}</span>
      <span className="text-[var(--fg-2)]">across {totals.changedFiles} {totals.changedFiles === 1 ? 'file' : 'files'}</span>
    </div>
  );
}

function Categories({ skeleton }: { skeleton: BranchSkeleton }) {
  const entries = CATEGORY_ORDER
    .map((c) => ({ category: c, count: skeleton.byCategory[c] ?? 0 }))
    .filter((e) => e.count > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">By category</h3>
      <ul className="flex flex-wrap gap-2">
        {entries.map(({ category, count }) => (
          <li
            key={category}
            className="rounded-[6px] bg-[var(--gray-2)] px-2.5 py-1 text-[12.5px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
          >
            <span className="font-medium text-[var(--fg-1)]">{CATEGORY_LABELS[category]}</span>
            <span className="ml-1.5 text-[var(--fg-3)]">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TouchedDirs({ skeleton }: { skeleton: BranchSkeleton }) {
  if (skeleton.touchedDirs.length === 0) return null;
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">Touched directories</h3>
      <ul className="flex flex-col gap-1">
        {skeleton.touchedDirs.map(({ dir, count }) => (
          <li key={dir} className="flex items-center justify-between text-[13px]">
            <span className="truncate font-mono text-[var(--fg-1)]">{dir || '.'}</span>
            <span className="ml-3 text-[var(--fg-3)]">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notable({ skeleton }: { skeleton: BranchSkeleton }) {
  if (skeleton.notable.length === 0) return null;
  return (
    <div className="mb-2">
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">Notable changes</h3>
      <ul className="flex flex-col gap-1">
        {skeleton.notable.map((f) => (
          <li key={f.path} className="flex items-center justify-between text-[13px]">
            <span className="truncate font-mono text-[var(--fg-1)]">{f.path}</span>
            <span className="ml-3 text-[var(--fg-3)]">
              <span style={{ color: 'var(--green-11)' }}>+{f.additions}</span>{' '}
              <span style={{ color: 'var(--red-11)' }}>−{f.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
