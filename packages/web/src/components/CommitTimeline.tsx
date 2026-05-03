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
      // Kick generation if this commit hasn't been narrated yet. Server is
      // idempotent — already-narrating SHAs early-return.
      const target = watch?.commits.find((c) => c.sha === sha);
      if (target && !target.hasNarrative) {
        await fetch('/api/narrative/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha }),
        });
      }
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

  return (
    <nav
      aria-label="Branch timeline"
      className="flex h-full flex-col gap-3 px-4 py-4 text-[13px]"
    >
      <button
        type="button"
        onClick={selectUnified}
        disabled={watchLoading}
        className="rounded-[8px] px-3 py-2 text-left text-[13px] font-medium transition-colors disabled:opacity-60"
        style={
          isUnified
            ? {
                background: 'var(--purple-3)',
                color: 'var(--purple-11)',
                boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
              }
            : {
                background: 'var(--gray-2)',
                color: 'var(--fg-2)',
                boxShadow: 'inset 0 0 0 1px var(--gray-a4)',
              }
        }
        title={watch.unifiedReady ? 'Whole-branch story (already generated)' : 'Generate the whole-branch story'}
      >
        <span className="mr-1.5">{watch.unifiedReady ? '◉' : '○'}</span>
        Whole branch
        <span className="ml-2 text-[11px] font-normal opacity-70">
          {watch.commits.length} {watch.commits.length === 1 ? 'commit' : 'commits'}
        </span>
      </button>

      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-3)]"
        style={{ paddingLeft: '4px' }}
      >
        Commits
      </div>

      {watch.commits.length === 0 ? (
        <p className="px-1 text-[12px] text-[var(--fg-3)]">No commits ahead of {watch.base}.</p>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {[...watch.commits].reverse().map((c) => (
            <CommitRow
              key={c.sha}
              commit={c}
              selected={selectedSha === c.sha}
              onSelect={() => selectCommit(c.sha)}
              disabled={watchLoading}
            />
          ))}
        </ol>
      )}

      {error ? <p className="px-1 text-[12px] text-[var(--red-11)]">{error}</p> : null}
    </nav>
  );
}

function CommitRow({
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
  const rowStyle: React.CSSProperties = selected
    ? {
        background: 'var(--brand-3, var(--purple-3))',
        color: 'var(--brand-11, var(--purple-11))',
        boxShadow: 'inset 0 0 0 1px var(--brand-a6, var(--purple-a6))',
      }
    : { background: 'transparent', color: 'var(--fg-1)' };

  const buttonLabel = commit.hasNarrative ? 'View' : 'Narrate';
  const buttonTitle = commit.hasNarrative
    ? `View ${commit.shortSha}'s narrative`
    : `Generate a narrative for ${commit.shortSha} (one model call)`;

  return (
    <li>
      <div
        className="group flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors"
        style={rowStyle}
        title={`${commit.shortSha}  ${commit.subject}\n${commit.author} · ${shortDate(commit.date)}\n+${commit.additions} −${commit.deletions} across ${commit.changedFiles} ${commit.changedFiles === 1 ? 'file' : 'files'}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="truncate text-[13px] font-medium leading-tight">{commit.subject}</span>
          <span className="flex items-center gap-2 text-[11px] text-[var(--fg-3)]">
            <span className="font-mono">{commit.shortSha}</span>
            <span aria-hidden>·</span>
            <span>
              <span style={{ color: 'var(--green-11)' }}>+{commit.additions}</span>{' '}
              <span style={{ color: 'var(--red-11)' }}>−{commit.deletions}</span>
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          title={buttonTitle}
          className="shrink-0 rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60"
          style={
            commit.hasNarrative
              ? {
                  background: 'var(--gray-3)',
                  color: 'var(--fg-2)',
                  boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
                }
              : {
                  background: 'transparent',
                  color: 'var(--fg-2)',
                  boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
                }
          }
        >
          {buttonLabel}
        </button>
      </div>
    </li>
  );
}
