import { useEffect, useMemo, useState } from 'react';
import { useScrollTracker } from '../hooks/useScrollTracker';
import { normalizePath } from '../lib/paths';
import { useReviewStore } from '../state/review-store';
import type { DiffFile } from '../state/types';
import { Chapter } from './Chapter';
import { ChapterTOC } from './ChapterTOC';
import { Comment } from './Comment';
import { ConcernsList } from './ConcernsList';
import { Hunk } from './Hunk';
import { MissingItems } from './MissingItems';
import { ReadingPlan } from './ReadingPlan';
import { VerdictBanner } from './VerdictBanner';
import { IconChat } from './Icons';

function OrphanedInlineComments() {
  const comments = useReviewStore((s) => s.comments);
  const narrative = useReviewStore((s) => s.narrative);
  const files = useReviewStore((s) => s.files);

  const orphanedHunks = useMemo(() => {
    if (!narrative) return [];

    const renderedHunkKeys = new Set<string>();
    narrative.chapters.forEach((ch) => {
      ch.sections.forEach((s) => {
        if (s.type === 'diff') {
          renderedHunkKeys.add(`${normalizePath(s.file)}:${s.hunkIndex}`);
        }
      });
    });

    const inlineComments = comments.filter((c) => c.path && c.line !== undefined);
    if (inlineComments.length === 0) return [];

    const needed: { file: DiffFile; hunkIndex: number }[] = [];
    const seen = new Set<string>();

    for (const c of inlineComments) {
      const normFile = normalizePath(c.path);
      const diffFile = files.find((f) => normalizePath(f.file) === normFile);
      if (!diffFile) continue;

      for (let hi = 0; hi < diffFile.hunks.length; hi++) {
        const key = `${normalizePath(diffFile.file)}:${hi}`;
        if (renderedHunkKeys.has(key)) continue;
        if (seen.has(key)) continue;
        const hunk = diffFile.hunks[hi]!;
        const start = hunk.newStart;
        const end = start + Math.max(hunk.newCount - 1, 0);
        const oldStart = hunk.oldStart;
        const oldEnd = oldStart + Math.max(hunk.oldCount - 1, 0);
        const hasComment = inlineComments.some((ic) => {
          if (normalizePath(ic.path) !== normalizePath(diffFile.file)) return false;
          if (ic.side === 'LEFT') {
            return ic.line !== undefined && ic.line >= oldStart && ic.line <= oldEnd;
          }
          return ic.line !== undefined && ic.line >= start && ic.line <= end;
        });
        if (hasComment) {
          seen.add(key);
          needed.push({ file: diffFile, hunkIndex: hi });
        }
      }
    }
    return needed;
  }, [comments, narrative, files]);

  if (orphanedHunks.length === 0) return null;

  return (
    <section className="mb-[28px]">
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] text-[var(--fg-3)]"
          style={{ background: 'var(--gray-3)' }}
        >
          <IconChat className="h-[12px] w-[12px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">Inline Comments</h2>
          <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">
            Comments on code not covered by the narrative above
          </p>
        </div>
      </div>
      <div className="ml-[34px] space-y-3">
        {orphanedHunks.map(({ file, hunkIndex }) => (
          <Hunk
            key={`${file.file}:${hunkIndex}`}
            file={file.file}
            hunk={file.hunks[hunkIndex]!}
            isNewFile={file.isNewFile}
            hunkIndex={hunkIndex}
          />
        ))}
      </div>
    </section>
  );
}

function Discussion() {
  const comments = useReviewStore((s) => s.comments);
  const narrative = useReviewStore((s) => s.narrative);

  const unmatched = useMemo(() => {
    if (!narrative) return [];

    const narrativeFiles = new Set<string>();
    narrative.chapters.forEach((ch) => {
      ch.sections.forEach((s) => {
        if (s.type === 'diff') narrativeFiles.add(normalizePath(s.file));
      });
    });

    return comments.filter((c) => {
      if (!c.path) return true;
      return !narrativeFiles.has(normalizePath(c.path));
    });
  }, [comments, narrative]);

  if (unmatched.length === 0) return null;

  const byId = new Map(unmatched.map((c) => [c.id, c]));
  const repliesByParent = new Map<number, typeof unmatched>();
  const roots: typeof unmatched = [];
  for (const c of unmatched) {
    if (c.inReplyToId !== undefined && byId.has(c.inReplyToId)) {
      const list = repliesByParent.get(c.inReplyToId) ?? [];
      list.push(c);
      repliesByParent.set(c.inReplyToId, list);
    } else {
      roots.push(c);
    }
  }

  return (
    <section data-chid="discussion" className="scroll-mt-[168px] mb-[28px]">
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] text-[var(--fg-3)]"
          style={{ background: 'var(--gray-3)' }}
        >
          <IconChat className="h-[12px] w-[12px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">PR Discussion</h2>
          <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">
            {roots.length} {roots.length === 1 ? 'thread' : 'threads'} not tied to specific code
          </p>
        </div>
      </div>
      <div className="ml-[34px] space-y-3">
        {roots.map((c) => (
          <div
            key={c.id}
            className="overflow-hidden rounded-[8px] bg-[var(--bg-panel)] px-4 py-3"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
          >
            <Comment comment={c} replies={repliesByParent.get(c.id) ?? []} showFilePath={!!c.path} />
          </div>
        ))}
      </div>
    </section>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function RegeneratingBanner() {
  const regenerating = useReviewStore((s) => s.regenerating);
  const progressChars = useReviewStore((s) => s.narrativeProgressChars);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!regenerating) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [regenerating]);

  if (!regenerating) return null;
  return (
    <div
      className="mb-6 flex items-center gap-2.5 rounded-[10px] px-4 py-3"
      style={{
        background: 'linear-gradient(180deg, var(--purple-2), var(--purple-3))',
        boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
      }}
    >
      <span className="animate-spin text-[14px]" style={{ color: 'var(--purple-11)' }}>
        ↻
      </span>
      <span className="text-[13.5px] font-medium" style={{ color: 'var(--purple-12)' }}>
        New commits detected — regenerating narrative...
      </span>
      <span className="ml-auto text-[12px] tabular-nums" style={{ color: 'var(--purple-11)' }}>
        {formatElapsed(elapsedMs)}
        {progressChars > 0 ? ` — ${progressChars.toLocaleString()} chars` : ''}
      </span>
    </div>
  );
}

export function StoryView() {
  useScrollTracker();
  const narrative = useReviewStore((s) => s.narrative);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  if (!narrative) return null;

  const compact = displayDensity === 'compact';
  const padY = compact ? 'py-4' : 'pt-[18px] pb-20';

  if (layoutMode === 'linear') {
    return (
      <div className={`mx-auto max-w-[880px] px-6 ${padY}`}>
        <main>
          <RegeneratingBanner />
          <VerdictBanner />
          <ReadingPlan />
          <ConcernsList />
          {narrative.chapters.map((ch, idx) => (
            <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
          ))}
          <MissingItems />
          <OrphanedInlineComments />
          <Discussion />
        </main>
      </div>
    );
  }

  return (
    <div className={`mx-auto grid max-w-[1100px] grid-cols-[220px_minmax(0,1fr)] gap-7 px-6 ${padY}`}>
      <ChapterTOC />
      <main className="min-w-0">
        <RegeneratingBanner />
        <VerdictBanner />
        <ReadingPlan />
        <ConcernsList />
        {narrative.chapters.map((ch, idx) => (
          <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
        ))}
        <MissingItems />
        <Discussion />
      </main>
    </div>
  );
}
