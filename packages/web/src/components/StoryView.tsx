import { type CSSProperties, Fragment, useEffect, useMemo, useState } from 'react';
import { useScrollTracker } from '../hooks/useScrollTracker';
import {
  callersByChapter,
  COLLAPSE_UNAVAILABLE_TEXT,
  type CollapsedSummary,
  collapsedSummary,
  decisionsByChapter,
  dividerIndex,
  truncationSummary,
  unavailableReason,
} from '../lib/collapse';
import { normalizePath } from '../lib/paths';
import { useReviewStore } from '../state/review-store';
import { useInlineComments } from '../hooks/useInlineComments';
import { useWalkthrough } from '../hooks/useWalkthrough';
import type { CapStats, CollapseResult, CommentId, DiffFile } from '../state/types';
import { ChapterTOC } from './ChapterTOC';
import type { ResolveItem } from '../lib/walkthrough';
import { Chapter } from './Chapter';
import { Comment } from './Comment';
import { Hunk } from './Hunk';
import { Overview } from './Overview';
import { ResolveStrip } from './ResolveStrip';
import { IconChat } from './Icons';

function OrphanedInlineComments() {
  const comments = useInlineComments();
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
  const comments = useInlineComments();
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
  const repliesByParent = new Map<CommentId, typeof unmatched>();
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

/**
 * The one collapse boundary, stated as a fact: how many chapters sit below it, how many diff lines they
 * hold, and what the collapse rests on. Lines rather than chapters because lines are what a reviewer
 * actually spends; chapter counts are gameable and say nothing about the reading saved.
 *
 * Exported for the render test — the divider's copy is the part of this feature that has to read as an
 * observation rather than as advice.
 */
export function CollapseDivider({ summary }: { summary: CollapsedSummary }) {
  return (
    <div className="mb-[18px] mt-[10px] grid grid-cols-[1fr_auto_1fr] items-center gap-3" data-collapse-divider>
      <span className="h-px" style={{ background: 'var(--gray-a4)' }} />
      <span
        className="whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium"
        style={{ background: 'var(--gray-3)', color: 'var(--fg-3)' }}
      >
        {summary.count} {summary.count === 1 ? 'chapter' : 'chapters'} below · {summary.lines.toLocaleString()}{' '}
        {summary.lines === 1 ? 'line' : 'lines'} · {summary.evidence}
      </span>
      <span className="h-px" style={{ background: 'var(--gray-a4)' }} />
    </div>
  );
}

/**
 * Why nothing collapsed. Each reason names its own cause, because they imply different actions — a size
 * cap is permanent for this repo, a failed fetch is worth retrying. A bare "unavailable" would be dead
 * chrome, so the reason text comes from a `Record` over the whole union rather than a default string.
 *
 * Exported for the render test.
 */
export function CollapseUnavailableNotice({ collapse }: { collapse: CollapseResult | null }) {
  const reason = unavailableReason(collapse);
  // Null for an available result *and* for no result at all: "not checked" is a different claim from
  // "checked and could not tell", and only the second one earns a line on screen.
  if (!reason) return null;
  return (
    <div
      className="mb-4 flex items-center gap-2.5 rounded-[10px] px-4 py-2.5 text-[12.5px]"
      style={{ background: 'var(--gray-2)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)', color: 'var(--fg-2)' }}
      data-collapse-notice
    >
      <span aria-hidden style={{ color: 'var(--fg-3)' }}>
        ○
      </span>
      <span>Blast radius unavailable — {COLLAPSE_UNAVAILABLE_TEXT[reason]}. Nothing was collapsed.</span>
    </div>
  );
}

/**
 * The diff the model never saw. Louder than the unavailable notice on purpose: missing repo context
 * makes the review less helpful, while a truncated diff makes it *incomplete* — the story was built from
 * a partial input and every conclusion in it inherits that.
 *
 * Renders nothing without stats (a cached narrative measured nothing) and nothing when the diff fit.
 * Exported for the render test.
 */
export function TruncationBanner({ capStats }: { capStats: CapStats | null }) {
  const summary = truncationSummary(capStats);
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.dropped > 0) parts.push(`${summary.dropped} ${summary.dropped === 1 ? 'file' : 'files'} dropped`);
  if (summary.shortened > 0) {
    parts.push(`${summary.shortened} ${summary.shortened === 1 ? 'file' : 'files'} shortened`);
  }
  return (
    <div
      className="mb-4 flex items-center gap-2.5 rounded-[10px] px-4 py-3 text-[13px]"
      style={{
        // Amber, not yellow: the scale only defines `--yellow-3` and `--yellow-11`, so a `--yellow-2`
        // background and a `--yellow-a5` border resolve to nothing and this banner reads as bare text in
        // both themes. `--amber-2` / `--amber-a5` / `--amber-11` exist in `:root` and `.dark`.
        background: 'var(--amber-2)',
        boxShadow: 'inset 0 0 0 1px var(--amber-a5)',
        color: 'var(--amber-11)',
      }}
      data-truncation-banner
    >
      <span aria-hidden>⚠</span>
      <span>
        <span className="font-semibold">This story was built from a partial diff</span> — {parts.join(', ')} before the
        model saw them.
      </span>
    </div>
  );
}

function OtherConcerns({ items }: { items: ResolveItem[] }) {
  if (items.length === 0) return null;
  return (
    <section data-chid="other" className="scroll-mt-[168px] mb-[28px]">
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] text-[var(--fg-3)]"
          style={{ background: 'var(--gray-3)' }}
        >
          <IconChat className="h-[12px] w-[12px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">Other</h2>
          <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">Concerns not tied to a chapter in the walkthrough</p>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <ResolveStrip key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function StoryView() {
  useScrollTracker();
  const narrative = useReviewStore((s) => s.narrative);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  const railCollapsed = useReviewStore((s) => s.railCollapsed);
  const storyStructure = useReviewStore((s) => s.storyStructure);
  const collapse = useReviewStore((s) => s.collapse);
  const callers = useReviewStore((s) => s.callers);
  const capStats = useReviewStore((s) => s.capStats);

  const decisions = useMemo(() => decisionsByChapter(collapse), [collapse]);
  const callerMap = useMemo(() => callersByChapter(callers), [callers]);
  const collapsed = useMemo(() => collapsedSummary(collapse, narrative?.chapters ?? []), [collapse, narrative]);
  // Only the `chapters` structure has a collapsed state to draw a boundary around: `outline` collapses
  // everything but the first chapter on its own, and `linear` never collapses. Drawing the divider there
  // anyway would promise a compression the reader is not getting.
  const divider = storyStructure === 'chapters' ? dividerIndex(collapse) : null;

  const walkthrough = useWalkthrough();
  const resolveByChapter = useMemo(() => {
    const map: Record<number, ResolveItem[]> = {};
    walkthrough?.beats.forEach((b) => {
      if (b.chapterIndex >= 0 && b.resolve.length > 0) map[b.chapterIndex] = b.resolve;
    });
    return map;
  }, [walkthrough]);
  const orphanItems = useMemo(() => walkthrough?.beats.find((b) => b.id === 'other')?.resolve ?? [], [walkthrough]);

  if (!narrative) return null;

  const compact = displayDensity === 'compact';
  const padY = compact ? 'py-4' : 'pt-[18px] pb-20';
  // A one-chapter story gets no rail and no chapter table — the diff below the Overview IS the
  // story, and a map of one destination is chrome (small-PR chapterless path).
  const solo = narrative.chapters.length <= 1;

  const body = (
    <main className="min-w-0">
      <RegeneratingBanner />
      <TruncationBanner capStats={capStats} />
      <CollapseUnavailableNotice collapse={collapse} />
      <Overview />
      {narrative.chapters.map((ch, idx) => (
        <Fragment key={`ch-${idx}`}>
          {divider === idx && collapsed ? <CollapseDivider summary={collapsed} /> : null}
          <Chapter
            index={idx}
            chapter={ch}
            resolve={resolveByChapter[idx]}
            decision={decisions[idx]}
            callers={callerMap[idx]}
          />
        </Fragment>
      ))}
      <OtherConcerns items={orphanItems} />
      <OrphanedInlineComments />
      <Discussion />
    </main>
  );

  if (layoutMode === 'linear' || solo) {
    return <div className={`mx-auto max-w-[880px] px-6 ${padY}`}>{body}</div>;
  }

  // Below `lg` the rail column collapses to zero and ChapterTOC renders its fixed breadcrumb pill
  // instead; at `lg`+ it is the left rail, narrowed to a strip when the reader collapses it.
  const railWidth = railCollapsed ? '28px' : '220px';
  return (
    <div
      className={`mx-auto grid max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-7 px-6 lg:grid-cols-[var(--rail-w)_minmax(0,1fr)] ${padY}`}
      style={{ '--rail-w': railWidth } as CSSProperties}
    >
      <ChapterTOC />
      {body}
    </div>
  );
}
