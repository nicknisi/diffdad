import { useState } from 'react';
import { applyNarrativeResponse, fetchNarrative } from '../hooks/useNarrative';
import { useReviewStore } from '../state/review-store';
import type { Addendum } from '../state/types';
import { Markdown } from './markdown/Markdown';

export function AddendumsView() {
  const watch = useReviewStore((s) => s.watch);
  const narrative = useReviewStore((s) => s.narrative);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!watch || !narrative) return null;
  const addendums = watch.addendums ?? [];
  if (addendums.length === 0) return null;

  async function regenerate() {
    setError(null);
    setRegenerating(true);
    try {
      await fetch('/api/narrative/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      // The story disappears while regenerating — pull the empty state so the
      // bobbing-skeleton view can take over until SSE delivers the new one.
      const data = await fetchNarrative('?mode=unified');
      applyNarrativeResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section
      className="mx-auto mt-10 max-w-[1100px] px-6 pb-20"
      aria-label="Story addendums"
    >
      <header className="mb-5 flex items-start justify-between gap-4 border-t border-[var(--gray-a4)] pt-6">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-3)]">
            Since this story was generated
          </p>
          <p className="mt-1 text-[14px] text-[var(--fg-2)]">
            {addendums.length} new {addendums.length === 1 ? 'commit' : 'commits'} landed after the
            whole-branch story above. The story may not reflect them yet — read these notes, then{' '}
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              className="underline underline-offset-2 hover:text-[var(--fg-1)] disabled:opacity-60"
            >
              regenerate
            </button>{' '}
            if it feels stale.
          </p>
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="shrink-0 rounded-[8px] px-3 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-60"
          style={{
            background: 'var(--purple-3)',
            color: 'var(--purple-11)',
            boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
          }}
        >
          {regenerating ? 'Regenerating…' : 'Regenerate story'}
        </button>
      </header>

      {error ? <p className="mb-3 text-[12px] text-[var(--red-11)]">{error}</p> : null}

      <ol className="flex flex-col gap-4">
        {addendums.map((a) => (
          <AddendumCard key={a.sha} addendum={a} />
        ))}
      </ol>
    </section>
  );
}

function AddendumCard({ addendum }: { addendum: Addendum }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      className="overflow-hidden rounded-[10px] bg-[var(--bg-panel)]"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      <header
        className="flex items-baseline gap-3 px-4 py-3"
        style={{
          background: 'var(--gray-2)',
          boxShadow: 'inset 0 -1px 0 var(--gray-a4)',
        }}
      >
        <span className="font-mono text-[11.5px] text-[var(--fg-3)]">{addendum.shortSha}</span>
        <span className="flex-1 truncate text-[14px] font-medium text-[var(--fg-1)]">
          {addendum.subject}
        </span>
        <span className="shrink-0 text-[11.5px] text-[var(--fg-3)]">
          <span style={{ color: 'var(--green-11)' }}>+{addendum.additions}</span>{' '}
          <span style={{ color: 'var(--red-11)' }}>−{addendum.deletions}</span>
        </span>
      </header>
      <div className="px-4 py-3 text-[13.5px] text-[var(--fg-1)]">
        {addendum.narrative ? (
          <AddendumBody narrative={addendum.narrative} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        ) : (
          <p className="italic text-[var(--fg-3)]">Narrating…</p>
        )}
      </div>
    </li>
  );
}

function AddendumBody({
  narrative,
  expanded,
  onToggle,
}: {
  narrative: NonNullable<Addendum['narrative']>;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Show the tldr (or first chapter summary) by default; expose chapter
  // detail behind a toggle so the addendum stays compact.
  const tldr = narrative.tldr ?? narrative.chapters[0]?.summary ?? '';
  return (
    <div className="flex flex-col gap-3">
      {tldr ? <Markdown source={tldr} /> : null}
      {narrative.chapters.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          className="self-start text-[12px] font-medium text-[var(--fg-2)] underline underline-offset-2 hover:text-[var(--fg-1)]"
        >
          {expanded ? 'Hide chapter detail' : `Show chapter detail (${narrative.chapters.length})`}
        </button>
      ) : null}
      {expanded
        ? narrative.chapters.map((ch, i) => (
            <article
              key={i}
              className="rounded-[6px] bg-[var(--bg-page)] px-3 py-2.5"
              style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
            >
              <h4 className="m-0 mb-1 text-[13px] font-semibold text-[var(--fg-1)]">{ch.title}</h4>
              <Markdown source={ch.summary} />
            </article>
          ))
        : null}
    </div>
  );
}
