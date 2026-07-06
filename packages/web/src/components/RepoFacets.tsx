import { useState } from 'react';
import { groupByOwner, type RepoFacet, type RepoFacets as RepoFacetsData } from '../lib/units-view';

type Props = {
  facets: RepoFacetsData;
  /** The active repo filter (`null` = All), driven by `useUnits`'s `repoFilter`. */
  value: string | null;
  onSelect: (repo: string | null) => void;
};

/** A dim group heading (`workos/`) shown only when the queue spans more than one owner. */
function OwnerLabel({ owner }: { owner: string }) {
  return <div className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-[var(--fg-3)]">{owner}/</div>;
}

/**
 * One facet row. Active state mirrors the story TOC's nav item (accent tint + `--purple-11` text,
 * which the accent picker retints) and carries `aria-current`. The count sits right-aligned:
 * needs-you for the queue, or a dim total for quiet repos so there's still a "something's in here" cue.
 */
function FacetButton({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: 'needs' | 'quiet';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-[7px] text-left text-[13px] transition-colors ${
        active ? 'font-semibold' : 'font-medium hover:bg-[var(--gray-a3)]'
      }`}
      style={active ? { background: 'var(--purple-a3)', color: 'var(--purple-11)' } : { color: 'var(--fg-2)' }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className="tabular-nums text-[12px]"
          style={{ color: active ? 'var(--purple-11)' : tone === 'needs' ? 'var(--fg-2)' : 'var(--fg-3)' }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The command center's repo filter, as a left rail under the sticky header (replaces the header
 * `<select>` at `md` and up). "All" plus one row per repo, needs-you counts computed from the
 * UNFILTERED queue so filtering never moves the numbers. Rows sort busiest-first; repos with nothing
 * waiting on Nick fold behind a "quiet" toggle (they still hold in-flight/cleared work). When the
 * queue spans multiple owners, rows group under dim owner labels to keep short names unambiguous.
 */
export function RepoFacets({ facets, value, onSelect }: Props) {
  const [showQuiet, setShowQuiet] = useState(false);
  const { needsYou, multipleOwners, busy, quiet } = facets;

  const renderRows = (list: RepoFacet[], tone: 'needs' | 'quiet') =>
    list.map((f) => (
      <FacetButton
        key={f.repo}
        label={f.shortName}
        count={tone === 'needs' ? f.needsYou : f.total}
        tone={tone}
        active={value === f.repo}
        onClick={() => onSelect(f.repo)}
      />
    ));

  const renderSection = (list: RepoFacet[], tone: 'needs' | 'quiet') => {
    if (!multipleOwners) return renderRows(list, tone);
    return groupByOwner(list).map((g) => (
      <div key={g.owner || '∅'} className="flex flex-col">
        {g.owner && <OwnerLabel owner={g.owner} />}
        {renderRows(g.repos, tone)}
      </div>
    ));
  };

  return (
    <nav
      aria-label="Filter by repository"
      className="sticky top-[54px] hidden max-h-[calc(100vh-54px)] w-56 shrink-0 flex-col self-start overflow-y-auto pb-6 pt-6 md:flex"
    >
      <FacetButton label="All" count={needsYou} tone="needs" active={value === null} onClick={() => onSelect(null)} />
      {renderSection(busy, 'needs')}
      {quiet.length > 0 && (
        <div className="mt-1 flex flex-col">
          <button
            type="button"
            onClick={() => setShowQuiet((v) => !v)}
            aria-expanded={showQuiet}
            className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-[7px] text-left text-[12px] font-medium text-[var(--fg-3)] transition-colors hover:text-[var(--fg-2)]"
          >
            <span
              aria-hidden
              className="inline-block transition-transform"
              style={{ transform: showQuiet ? 'rotate(90deg)' : 'none' }}
            >
              ▸
            </span>
            quiet
            <span className="tabular-nums">{quiet.length}</span>
          </button>
          {showQuiet && renderSection(quiet, 'quiet')}
        </div>
      )}
    </nav>
  );
}
