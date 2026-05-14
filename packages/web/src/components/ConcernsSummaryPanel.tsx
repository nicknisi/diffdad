import { useEffect, useMemo, useState } from 'react';
import { useAggregatedFindings, type Finding } from '../hooks/useAggregatedFindings';
import { normalizePath } from '../lib/paths';
import { useReviewStore } from '../state/review-store';
import type { ConcernCategory, ConcernStatus } from '../state/types';
import { FindingRow, CATEGORY_LABELS, CATEGORY_STYLES, LEVEL_STYLES } from './FindingRow';
import { IconChat, IconChevron } from './Icons';

const ALL_CATEGORIES: ConcernCategory[] = [
  'logic',
  'state',
  'timing',
  'validation',
  'security',
  'test-gap',
  'api-contract',
  'error-handling',
];
const ALL_LEVELS = ['nit', 'concern', 'warning'] as const;

function findingKey(f: Finding): string {
  if (f.kind === 'concern') return `${f.file}:${f.line}:${f.concern.question.slice(0, 80)}`;
  return `callout:${f.file}:${f.line}:${f.callout.message.slice(0, 80)}`;
}

function loadDismissed(prNumber: number | undefined, prefix: string): Set<string> {
  if (prNumber == null) return new Set();
  try {
    const raw = localStorage.getItem(`diffdad.${prefix}.${prNumber}`);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
    }
  } catch {}
  return new Set();
}

function saveDismissed(prNumber: number | undefined, prefix: string, set: Set<string>) {
  if (prNumber == null) return;
  try {
    localStorage.setItem(`diffdad.${prefix}.${prNumber}`, JSON.stringify([...set]));
  } catch {}
}

function buildDeltaKey(file: string, line: number, discriminator: string): string {
  return `${normalizePath(file)}::${line}::${discriminator}`;
}

export function ConcernsSummaryPanel() {
  const findings = useAggregatedFindings();
  const prNumber = useReviewStore((s) => s.pr?.number);
  const previousReview = useReviewStore((s) => s.previousReview);
  const panelOpen = useReviewStore((s) => s.concernsPanelOpen);
  const setPanelOpen = useReviewStore((s) => s.setConcernsPanelOpen);
  const selectedCategories = useReviewStore((s) => s.selectedConcernCategories);
  const selectedLevels = useReviewStore((s) => s.selectedCalloutLevels);
  const toggleCategory = useReviewStore((s) => s.toggleConcernCategory);
  const toggleLevel = useReviewStore((s) => s.toggleCalloutLevel);
  const resetFilters = useReviewStore((s) => s.resetFindingFilters);

  const deltaStatusMap = useMemo(() => {
    const map = new Map<string, ConcernStatus>();
    if (!previousReview) return map;
    for (const sc of previousReview.concerns) {
      map.set(buildDeltaKey(sc.file, sc.line, `${sc.category}:${sc.question.slice(0, 80)}`), sc.status);
    }
    for (const sc of previousReview.callouts) {
      map.set(buildDeltaKey(sc.file, sc.line, `${sc.chapterIndex}:${sc.level}:${sc.message.slice(0, 80)}`), sc.status);
    }
    return map;
  }, [previousReview]);

  function getDeltaStatus(f: Finding): ConcernStatus | undefined {
    if (!previousReview) return undefined;
    if (f.kind === 'concern') {
      return deltaStatusMap.get(buildDeltaKey(f.file, f.line, `${f.concern.category}:${f.concern.question.slice(0, 80)}`));
    }
    return deltaStatusMap.get(buildDeltaKey(f.file, f.line, `${f.chapterIndex}:${f.callout.level}:${f.callout.message.slice(0, 80)}`));
  }

  const allFindings = useMemo(() => {
    if (!previousReview) return findings;
    const fixedConcerns: Finding[] = previousReview.concerns
      .filter((sc) => sc.status === 'fixed')
      .map((sc) => ({
        kind: 'concern' as const,
        concern: { question: sc.question, file: sc.file, line: sc.line, category: sc.category, why: sc.why },
        file: sc.file,
        line: sc.line,
      }));
    const fixedCallouts: Finding[] = previousReview.callouts
      .filter((sc) => sc.status === 'fixed')
      .map((sc) => ({
        kind: 'callout' as const,
        callout: { file: sc.file, line: sc.line, level: sc.level, message: sc.message },
        file: sc.file,
        line: sc.line,
        chapterIndex: sc.chapterIndex,
      }));
    return [...findings, ...fixedConcerns, ...fixedCallouts];
  }, [findings, previousReview]);

  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const concerns = loadDismissed(prNumber, 'concernsDismissed');
    const callouts = loadDismissed(prNumber, 'calloutsDismissed');
    return new Set([...concerns, ...callouts]);
  });
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    const concerns = loadDismissed(prNumber, 'concernsDismissed');
    const callouts = loadDismissed(prNumber, 'calloutsDismissed');
    setDismissed(new Set([...concerns, ...callouts]));
  }, [prNumber]);

  if (allFindings.length === 0) return null;

  function dismiss(f: Finding) {
    setDismissed((prev) => {
      const next = new Set(prev);
      const key = findingKey(f);
      next.add(key);
      const prefix = f.kind === 'concern' ? 'concernsDismissed' : 'calloutsDismissed';
      const stored = loadDismissed(prNumber, prefix);
      stored.add(key);
      saveDismissed(prNumber, prefix, stored);
      return next;
    });
  }

  function undismissAll() {
    setDismissed(new Set());
    saveDismissed(prNumber, 'concernsDismissed', new Set());
    saveDismissed(prNumber, 'calloutsDismissed', new Set());
  }

  const allCategoriesSelected = selectedCategories.size === ALL_CATEGORIES.length;
  const allLevelsSelected = selectedLevels.size === ALL_LEVELS.length;

  const filtered = allFindings.filter((f) => {
    if (f.kind === 'concern') {
      return allCategoriesSelected || selectedCategories.has(f.concern.category);
    }
    return allLevelsSelected || selectedLevels.has(f.callout.level);
  });

  const undismissedFiltered = filtered.filter((f) => !dismissed.has(findingKey(f)));
  const dismissedCount = filtered.length - undismissedFiltered.length;
  const renderList = showDismissed ? filtered : undismissedFiltered;

  const categoryCounts = new Map<ConcernCategory, number>();
  const levelCounts = new Map<string, number>();
  for (const f of allFindings) {
    if (f.kind === 'concern') {
      categoryCounts.set(f.concern.category, (categoryCounts.get(f.concern.category) ?? 0) + 1);
    } else {
      levelCounts.set(f.callout.level, (levelCounts.get(f.callout.level) ?? 0) + 1);
    }
  }

  return (
    <section className="mb-[28px]">
      <div
        className="cursor-pointer rounded-t-[10px] px-4 py-3"
        style={{
          background: 'var(--bg-panel)',
          boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
        }}
        onClick={() => setPanelOpen(!panelOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPanelOpen(!panelOpen);
          }
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px]"
            style={{ background: 'var(--amber-3)', color: 'var(--amber-11)' }}
          >
            <IconChat className="h-[12px] w-[12px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 flex items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
              Findings
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                style={{ background: 'var(--amber-3)', color: 'var(--amber-11)' }}
              >
                {allFindings.length}
              </span>
            </h2>
            <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">
              {undismissedFiltered.length} of {allFindings.length} visible
              {previousReview && (previousReview.summary.fixed > 0 || previousReview.summary.new > 0) && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--green-11)' }}>{previousReview.summary.fixed} fixed</span>
                  {', '}
                  {previousReview.summary.unfixed} remain
                  {', '}
                  <span style={{ color: 'var(--blue-11)' }}>{previousReview.summary.new} new</span>
                </>
              )}
              {(!allCategoriesSelected || !allLevelsSelected) && (
                <> · {selectedCategories.size} categories, {selectedLevels.size} levels</>
              )}
              {dismissedCount > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDismissed((v) => !v);
                    }}
                    className="underline-offset-2 hover:text-[var(--fg-1)] hover:underline"
                  >
                    {showDismissed ? 'Hide' : 'Show'} {dismissedCount} dismissed
                  </button>
                  {showDismissed && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          undismissAll();
                        }}
                        className="underline-offset-2 hover:text-[var(--fg-1)] hover:underline"
                      >
                        Restore all
                      </button>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          <span
            className="flex h-5 w-5 items-center justify-center text-[var(--fg-3)] transition-transform duration-200"
            style={{ transform: panelOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            <IconChevron className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
      {panelOpen && (
        <div
          className="rounded-b-[10px] border-t-0 px-4 pb-4 pt-3"
          style={{
            background: 'var(--bg-panel)',
            boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
            borderTop: '1px solid var(--gray-a4)',
          }}
        >
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {ALL_CATEGORIES.map((cat) => {
              const count = categoryCounts.get(cat) ?? 0;
              if (count === 0) return null;
              const active = selectedCategories.has(cat);
              const style = CATEGORY_STYLES[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] transition-opacity"
                  style={{
                    background: active ? style.bg : 'var(--gray-3)',
                    color: active ? style.color : 'var(--fg-3)',
                    opacity: active ? 1 : 0.5,
                  }}
                >
                  {CATEGORY_LABELS[cat]}
                  <span className="ml-0.5 text-[9.5px] opacity-70">{count}</span>
                </button>
              );
            })}
            <span className="mx-1 h-3 w-px" style={{ background: 'var(--gray-a4)' }} />
            {ALL_LEVELS.map((lvl) => {
              const count = levelCounts.get(lvl) ?? 0;
              if (count === 0) return null;
              const active = selectedLevels.has(lvl);
              const style = LEVEL_STYLES[lvl]!;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => toggleLevel(lvl)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] transition-opacity"
                  style={{
                    background: active ? style.bg : 'var(--gray-3)',
                    color: active ? style.color : 'var(--fg-3)',
                    opacity: active ? 1 : 0.5,
                  }}
                >
                  {style.label}
                  <span className="ml-0.5 text-[9.5px] opacity-70">{count}</span>
                </button>
              );
            })}
            {(!allCategoriesSelected || !allLevelsSelected) && (
              <button
                type="button"
                onClick={resetFilters}
                className="ml-1 text-[10.5px] text-[var(--fg-3)] underline-offset-2 hover:text-[var(--fg-1)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
          <ul className="list-none space-y-2 p-0">
            {renderList.map((f) => {
              const key = findingKey(f);
              const isDismissed = dismissed.has(key);
              return (
                <FindingRow key={key} finding={f} onDismiss={() => dismiss(f)} dimmed={isDismissed} deltaStatus={getDeltaStatus(f)} />
              );
            })}
          </ul>
          {renderList.length === 0 && (
            <p className="py-4 text-center text-[13px] text-[var(--fg-3)]">
              No findings match the current filters.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
