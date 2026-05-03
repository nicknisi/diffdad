import { useState } from 'react';
import { applyNarrativeResponse, fetchNarrative } from '../hooks/useNarrative';
import { useReviewStore } from '../state/review-store';
import type { WatchCommitSummary } from '../state/types';

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CommitTimeline() {
  const watch = useReviewStore((s) => s.watch);
  const setWatchLoading = useReviewStore((s) => s.setWatchLoading);
  const watchLoading = useReviewStore((s) => s.watchLoading);
  const [error, setError] = useState<string | null>(null);

  if (!watch) return null;

  const isUnified = watch.selection.kind === 'unified';
  const selectedSha = watch.selection.kind === 'commit' ? watch.selection.sha : null;

  async function selectCommit(sha: string) {
    setError(null);
    setWatchLoading(true);
    try {
      const data = await fetchNarrative(`?sha=${encodeURIComponent(sha)}`);
      applyNarrativeResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commit');
    } finally {
      setWatchLoading(false);
    }
  }

  async function selectUnified() {
    setError(null);
    setWatchLoading(true);
    try {
      // If unified isn't ready yet, ask the server to start generating.
      if (!watch?.unifiedReady) {
        await fetch('/api/narrative/unified', { method: 'POST' });
      }
      const data = await fetchNarrative('?mode=unified');
      applyNarrativeResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load unified view');
    } finally {
      setWatchLoading(false);
    }
  }

  if (watch.commits.length === 0) {
    return (
      <section
        className="sticky z-10 bg-[var(--bg-page)] px-6 py-3"
        style={{ top: 'calc(52px + 96px)', boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        <p className="text-[13px] text-[var(--fg-3)]">No commits ahead of {watch.base} yet — waiting for new commits.</p>
      </section>
    );
  }

  return (
    <section
      className="sticky z-10 bg-[var(--bg-page)] px-6 py-3"
      style={{ top: 'calc(52px + 96px)', boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={selectUnified}
          disabled={watchLoading}
          className="shrink-0 rounded-[6px] px-2.5 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-60"
          style={
            isUnified
              ? {
                  background: 'var(--purple-3)',
                  color: 'var(--purple-11)',
                  boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
                }
              : { background: 'var(--gray-2)', color: 'var(--fg-2)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }
          }
          title={watch.unifiedReady ? 'Whole-branch story (already generated)' : 'Generate the whole-branch story'}
        >
          {watch.unifiedReady ? '◉ Whole branch' : '○ Whole branch'}
        </button>
        <div className="flex-1 overflow-x-auto">
          <ol className="flex items-center gap-2 whitespace-nowrap">
            {watch.commits.map((c) => (
              <CommitChip
                key={c.sha}
                commit={c}
                selected={selectedSha === c.sha}
                onSelect={() => selectCommit(c.sha)}
                disabled={watchLoading}
              />
            ))}
          </ol>
        </div>
      </div>
      {error ? <p className="mt-2 text-[12px] text-[var(--red-11)]">{error}</p> : null}
    </section>
  );
}

function CommitChip({
  commit,
  selected,
  onSelect,
  disabled,
}: {
  commit: WatchCommitSummary;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const stateStyle: React.CSSProperties = selected
    ? {
        background: 'var(--brand-3, var(--purple-3))',
        color: 'var(--brand-11, var(--purple-11))',
        boxShadow: 'inset 0 0 0 1px var(--brand-a6, var(--purple-a6))',
      }
    : commit.hasNarrative
      ? { background: 'var(--gray-2)', color: 'var(--fg-1)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }
      : { background: 'transparent', color: 'var(--fg-3)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' };

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-[6px] px-2.5 py-1 text-left text-[12.5px] transition-colors disabled:opacity-60"
        style={stateStyle}
        title={`${commit.shortSha}  ${commit.subject}\n${commit.author} · ${shortDate(commit.date)}\n+${commit.additions} −${commit.deletions} across ${commit.changedFiles} ${commit.changedFiles === 1 ? 'file' : 'files'}${
          commit.hasNarrative ? '' : '\n(narration pending)'
        }`}
      >
        <span className="font-mono text-[11.5px] opacity-80">{commit.shortSha}</span>
        <span className="max-w-[200px] truncate font-medium">{commit.subject}</span>
        {!commit.hasNarrative ? <span className="text-[11px] opacity-70">…</span> : null}
      </button>
    </li>
  );
}
