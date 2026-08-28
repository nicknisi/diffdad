import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAnchor } from '../lib/anchor';
import { collapseReason, initialCollapsed } from '../lib/collapse';
import { normalizePath } from '../lib/paths';
import { useReviewStore } from '../state/review-store';
import { useInlineComments } from '../hooks/useInlineComments';
import type {
  Callout,
  Chapter as ChapterType,
  ChapterCallers,
  CollapseDecision,
  DiffFile,
  DiffHunk,
  HunkAnchor,
} from '../state/types';
import { Hunk } from './Hunk';
import { IconCheck, IconChevron } from './Icons';
import { NarrationAnchor } from './NarrationAnchor';
import { NarrationBlock } from './NarrationBlock';
import { ResolveStrip } from './ResolveStrip';
import type { ResolveItem } from '../lib/walkthrough';

type Props = {
  index: number;
  chapter: ChapterType;
  /** Open questions for this beat — rendered as inline resolve strips. */
  resolve?: ResolveItem[];
  /**
   * Present when the server found checkable evidence that this chapter is safe to hide by default.
   *
   * Applied at mount and once more on its first arrival, because on both live paths it lands *after* the
   * chapters have mounted. Never applied again after that: re-renders (a live comment, a check update)
   * hand over a fresh object with the same content, and a reviewer who has already worked this row keeps
   * whatever they chose.
   */
  decision?: CollapseDecision;
  /** Unchanged repository files that import this chapter's files — the argument for reading it. */
  callers?: ChapterCallers;
};

const RISK_STYLES: Record<ChapterType['risk'], React.CSSProperties> = {
  low: { background: 'var(--gray-3)', color: 'var(--fg-2)' },
  medium: { background: 'var(--yellow-3)', color: 'var(--yellow-11)' },
  high: { background: 'var(--red-3)', color: 'var(--red-11)' },
};

const RISK_LABELS: Record<ChapterType['risk'], string> = {
  low: 'low risk',
  medium: 'medium risk',
  high: 'high risk',
};

const CALLOUT_STYLES: Record<Callout['level'], { bg: string; border: string; color: string; label: string }> = {
  nit: { bg: 'var(--gray-2)', border: 'var(--gray-a4)', color: 'var(--fg-2)', label: 'Nit' },
  concern: { bg: 'var(--yellow-2)', border: 'var(--yellow-a4)', color: 'var(--yellow-11)', label: 'Concern' },
  warning: { bg: 'var(--red-2)', border: 'var(--red-a4)', color: 'var(--red-11)', label: 'Warning' },
};

function CalloutList({ callouts }: { callouts: Callout[] }) {
  return (
    <div className="ml-[34px] space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Review callouts</div>
      {callouts.map((c, i) => {
        const style = CALLOUT_STYLES[c.level];
        return (
          <div
            key={i}
            className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px] leading-[19px]"
            style={{ background: style.bg, boxShadow: `inset 0 0 0 1px ${style.border}` }}
          >
            <span
              className="mt-[1px] inline-flex flex-shrink-0 items-center rounded-full px-[6px] py-[1px] text-[10px] font-bold uppercase tracking-[0.04em]"
              style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}
            >
              {style.label}
            </span>
            <span className="flex-1 text-[var(--fg-2)]">
              <span className="font-mono text-[11.5px] text-[var(--fg-3)]">
                {c.file}:{c.line}
              </span>{' '}
              {c.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MissingHunkBanner({
  file,
  hunkIndex,
  kind = 'primary',
}: {
  file: string;
  hunkIndex: number;
  kind?: 'primary' | 'reshow';
}) {
  const label = kind === 'reshow' ? 'Missing reshow hunk' : 'Missing hunk';
  return (
    <div
      className="ml-[34px] mb-[14px] flex items-start gap-2 rounded-[8px] px-3.5 py-2.5 text-[13px] leading-[19px]"
      style={{
        background: 'var(--yellow-2)',
        boxShadow: 'inset 0 0 0 1px var(--yellow-a5)',
        color: 'var(--yellow-11)',
      }}
      data-warning="missing-hunk"
    >
      <span aria-hidden className="mt-[1px]">
        ⚠
      </span>
      <span>
        <span className="font-bold uppercase tracking-[0.04em] text-[10.5px] mr-1.5">{label}</span>
        <span className="font-mono text-[11.5px]">
          {file}#{hunkIndex}
        </span>{' '}
        — referenced by the narrative but not present in the diff.
      </span>
    </div>
  );
}

function ReshowBlock({
  ownerLabel,
  framing,
  warning,
  children,
}: {
  ownerLabel: string;
  framing?: string;
  warning?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="ml-[34px] mb-[14px] overflow-hidden rounded-[8px]"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
        borderLeft: '2px solid var(--purple-9)',
        background: 'linear-gradient(180deg, var(--purple-2), transparent)',
      }}
    >
      <div className="px-4 pt-3.5 pb-3" style={{ borderBottom: '1px dashed var(--gray-a5)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-medium tracking-[0.02em]"
            style={{
              background: 'var(--purple-3)',
              color: 'var(--purple-11)',
              boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
            }}
          >
            <span aria-hidden>↻</span>
            Showing again from {ownerLabel}
          </span>
          {warning ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-medium uppercase tracking-[0.04em]"
              style={{
                background: 'var(--yellow-3)',
                color: 'var(--yellow-11)',
                boxShadow: 'inset 0 0 0 1px var(--yellow-a5)',
              }}
              title={warning}
              data-warning="duplicate-primary"
            >
              <span aria-hidden>⚠</span>
              {warning}
            </span>
          ) : null}
        </div>
        {framing ? (
          <div className="mt-2 text-[14px] leading-[22px]" style={{ color: 'var(--fg-2)', maxWidth: '70ch' }}>
            <NarrationBlock content={framing} />
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

type FlatHunk = { hunk: DiffHunk; file: string; isNewFile: boolean; hunkIndex: number };

/**
 * Resolve a diff section to a concrete hunk. Prefers the direct `hunks[hunkIndex]` lookup, but falls
 * back to the content anchor when the index is missing OR the hunk it lands on no longer matches the
 * anchor's `contentHash` (the diff shifted shape since the narrative was written). `hunkIndex` in the
 * result is the resolved index, which may differ from the requested one.
 */
function findHunk(files: DiffFile[], file: string, hunkIndex: number, anchor?: HunkAnchor): FlatHunk | null {
  const norm = normalizePath(file);
  const diffFile = files.find((f) => normalizePath(f.file) === norm);
  const direct = diffFile?.hunks[hunkIndex];
  const directMatchesAnchor =
    !anchor || direct == null || direct.contentHash == null || direct.contentHash === anchor.contentHash;

  if (diffFile && direct && directMatchesAnchor) {
    return { hunk: direct, file: diffFile.file, isNewFile: diffFile.isNewFile, hunkIndex };
  }

  if (anchor) {
    const resolved = resolveAnchor(files, anchor);
    if (resolved) {
      const hunk = resolved.file.hunks[resolved.hunkIndex]!;
      return { hunk, file: resolved.file.file, isNewFile: resolved.file.isNewFile, hunkIndex: resolved.hunkIndex };
    }
  }

  // No anchor (or it failed): fall back to the direct hit if one exists at all.
  if (diffFile && direct) {
    return { hunk: direct, file: diffFile.file, isNewFile: diffFile.isNewFile, hunkIndex };
  }
  return null;
}

export function Chapter({ index, chapter, resolve, decision, callers }: Props) {
  const files = useReviewStore((s) => s.files);
  const comments = useInlineComments();
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const toggleReviewed = useReviewStore((s) => s.toggleReviewed);
  const storyStructure = useReviewStore((s) => s.storyStructure);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  const narrative = useReviewStore((s) => s.narrative);
  const narrationOverrides = useReviewStore((s) => s.narrationOverrides);
  const pendingChapterThemeIds = useReviewStore((s) => s.pendingChapterThemeIds);
  const id = `ch-${index}`;
  const reviewed = chapterStates[id] === 'reviewed';
  const isStreaming = chapter.themeId !== undefined && pendingChapterThemeIds.has(chapter.themeId);

  // Map of `${file}:${hunkIndex}` -> first chapter index that uses that hunk via a diff section.
  // Multiple files can share hunkIndex 0, so the key must include the file.
  const hunkOwners = useMemo(() => {
    const owners = new Map<string, number>();
    if (!narrative) return owners;
    narrative.chapters.forEach((ch, ci) => {
      ch.sections.forEach((s) => {
        if (s.type === 'diff') {
          const key = `${s.file}:${s.hunkIndex}`;
          if (!owners.has(key)) owners.set(key, ci);
        }
      });
    });
    return owners;
  }, [narrative]);

  // Fallback map for reshow entries missing the `file` field (older cached narratives).
  const refToFileFallback = useMemo(() => {
    const map = new Map<number, string>();
    if (!narrative) return map;
    narrative.chapters.forEach((ch) => {
      ch.sections.forEach((s) => {
        if (s.type === 'diff' && !map.has(s.hunkIndex)) {
          map.set(s.hunkIndex, s.file);
        }
      });
    });
    return map;
  }, [narrative]);

  // Hunks already rendered as diff sections by earlier chapters — duplicates render as reshow.
  const priorHunks = useMemo(() => {
    const set = new Set<string>();
    if (!narrative) return set;
    for (let ci = 0; ci < index; ci++) {
      for (const s of narrative.chapters[ci]!.sections) {
        if (s.type === 'diff') set.add(`${s.file}:${s.hunkIndex}`);
      }
    }
    return set;
  }, [narrative, index]);

  // Assign each annotation (resolve item / callout) to the ONE hunk section whose new-side
  // line range contains it; the Hunk then renders it inline at that line. Anything matching
  // no shown hunk falls through to a trailing group so none are lost.
  const annotationPlacement = useMemo(() => {
    const bySection: Record<number, { resolve: ResolveItem[]; callouts: Callout[] }> = {};
    const placedResolve = new Set<string>();
    const placedCallout = new Set<number>();
    const items = resolve ?? [];
    const callouts = chapter.callouts ?? [];
    const bucket = (i: number) => (bySection[i] ??= { resolve: [], callouts: [] });
    chapter.sections.forEach((section, i) => {
      if (section.type !== 'diff') return;
      const flat = findHunk(files, section.file, section.hunkIndex, section.anchor);
      if (!flat) return;
      const nf = normalizePath(flat.file);
      const start = flat.hunk.newStart;
      const end = start + Math.max(flat.hunk.newCount - 1, 0);
      for (const item of items) {
        if (placedResolve.has(item.id) || !item.file || item.line == null) continue;
        if (normalizePath(item.file) !== nf) continue;
        if (item.line >= start && item.line <= end) {
          bucket(i).resolve.push(item);
          placedResolve.add(item.id);
        }
      }
      callouts.forEach((c, ci) => {
        if (placedCallout.has(ci)) return;
        if (normalizePath(c.file) !== nf) return;
        if (c.line >= start && c.line <= end) {
          bucket(i).callouts.push(c);
          placedCallout.add(ci);
        }
      });
    });
    return {
      bySection,
      leftoverResolve: items.filter((it) => !placedResolve.has(it.id)),
      leftoverCallouts: callouts.filter((_, ci) => !placedCallout.has(ci)),
    };
  }, [chapter.sections, chapter.callouts, resolve, files]);

  // Two seeds, one boolean, two transition effects shaped identically: each writes `collapsed` only on
  // the edge that means "this just became true", never on every render. That is what keeps them from
  // fighting.
  //
  // The mount seed alone is not enough, because on both live paths the decision arrives *after* these
  // chapters mount: the streaming path mounts placeholders from `applyPlan` under the same `ch-${idx}`
  // keys (so React reuses these instances when the finished narrative replaces the array), and a cached
  // narrative gets its boundary from the `collapse` SSE event once the snapshot resolves. Without the
  // transition below, the divider would render above four chapters that are all still expanded.
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(reviewed, decision));
  // Set the moment the reviewer works this row themselves. A decision arriving later must not overrule
  // them — collapse is a default, and a default only applies while it is still the default.
  const touched = useRef(false);
  const toggleCollapsed = () => {
    touched.current = true;
    setCollapsed((v) => !v);
  };
  const prevReviewed = useRef(reviewed);
  useEffect(() => {
    if (reviewed && !prevReviewed.current) setCollapsed(true);
    prevReviewed.current = reviewed;
  }, [reviewed]);
  // Not gated on `touched`: marking a chapter reviewed IS the reviewer acting, and it outranks whatever
  // they did to the chevron a moment earlier.
  const prevHadDecision = useRef(decision !== undefined);
  useEffect(() => {
    const hasDecision = decision !== undefined;
    if (hasDecision && !prevHadDecision.current && !touched.current) setCollapsed(true);
    prevHadDecision.current = hasDecision;
  }, [decision]);
  // A TOC jump or find-widget navigation targeting this chapter forces it open so the destination is
  // visible. Keyed on `nonce` so revealing the same chapter twice still expands it after a manual
  // re-collapse. Counts as the reviewer acting (`touched`) so a later decision cannot re-collapse it.
  const chapterReveal = useReviewStore((s) => s.chapterReveal);
  useEffect(() => {
    if (chapterReveal?.chid !== id) return;
    touched.current = true;
    setCollapsed(false);
  }, [chapterReveal, id]);
  // `reviewed` wins: both seeds produce the same collapsed row, so precedence only decides which line
  // explains it, and the reviewer's own action outranks the tool's inference.
  const reasonLine = collapseReason(decision, reviewed);

  // Outline: collapsed by default, except chapter 0
  const [outlineOpen, setOutlineOpen] = useState(index === 0);

  const compact = displayDensity === 'compact';

  const hunkSections = useMemo(() => chapter.sections.filter((s) => s.type === 'diff'), [chapter.sections]);
  const hunkCount = hunkSections.length;

  // Count comments belonging to this chapter's hunks (file + line range)
  const commentCount = useMemo(() => {
    let count = 0;
    for (const section of hunkSections) {
      if (section.type !== 'diff') continue;
      const flat = findHunk(files, section.file, section.hunkIndex, section.anchor);
      if (!flat) continue;
      const start = flat.hunk.newStart;
      const end = start + Math.max(flat.hunk.newCount - 1, 0);
      for (const c of comments) {
        if (c.path !== flat.file) continue;
        if (c.line === undefined) continue;
        if (c.line >= start && c.line <= end) count++;
      }
    }
    return count;
  }, [hunkSections, files, comments]);

  const riskPill = (
    <span
      className="inline-flex items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
      style={RISK_STYLES[chapter.risk]}
    >
      {RISK_LABELS[chapter.risk]}
    </span>
  );

  const reviewedButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleReviewed(index);
      }}
      className="ml-auto inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] font-medium"
      style={
        reviewed
          ? {
              background: 'var(--green-3)',
              color: 'var(--green-11)',
              boxShadow: 'inset 0 0 0 1px var(--green-a3)',
            }
          : {
              color: 'var(--fg-2)',
              boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
            }
      }
    >
      {reviewed ? (
        <>
          <IconCheck className="h-[11px] w-[11px]" />
          Reviewed
        </>
      ) : (
        'Mark reviewed'
      )}
    </button>
  );

  const summary = chapter.summary?.trim();
  const whyMatters = chapter.whyMatters?.trim();
  const narrativeSections = chapter.sections.filter(
    (section): section is Extract<ChapterType['sections'][number], { type: 'narrative' }> =>
      section.type === 'narrative',
  );
  const firstNarrativeIndex = chapter.sections.findIndex((section) => section.type === 'narrative');
  const hasNarrationOverride = id in narrationOverrides;
  const extraNarration = hasNarrationOverride ? [] : narrativeSections.slice(1);
  const streamingIndicator = isStreaming ? (
    <div
      className="ml-[34px] mb-[14px] flex items-center gap-2 rounded-[8px] px-3.5 py-2.5 text-[13px]"
      style={{
        background: 'var(--purple-2)',
        boxShadow: 'inset 0 0 0 1px var(--purple-a4)',
        color: 'var(--purple-11)',
      }}
      data-streaming="true"
    >
      <span className="flex gap-1">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out infinite' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out 0.2s infinite' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out 0.4s infinite' }}
        />
      </span>
      <span>Writing chapter prose…</span>
    </div>
  ) : null;
  // Who depends on this code, as an argument for reading it. Lives in the body rather than the header
  // for two reasons: it is only meaningful on a chapter that is open (a collapsed chapter's evidence is
  // that nothing imports it, so this is empty there by construction), and a `<details>` inside the
  // clickable header would fight the collapse toggle. Capped by the server, with the remainder stated —
  // a module with 200 importers must give the number without pasting 200 paths into a chapter.
  const callerDisclosure =
    callers && callers.total > 0 ? (
      <details
        className="ml-[34px] rounded-[8px] px-3 py-2 text-[12.5px]"
        style={{ background: 'var(--gray-2)', color: 'var(--fg-2)' }}
        data-caller-disclosure
      >
        <summary className="cursor-pointer font-medium text-[var(--fg-3)]">
          Imported by {callers.total} unchanged {callers.total === 1 ? 'file' : 'files'}
        </summary>
        <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-[var(--fg-3)]">
          {callers.callers.map((caller) => (
            <li key={caller}>{caller}</li>
          ))}
          {callers.total > callers.callers.length ? (
            <li style={{ fontStyle: 'italic' }}>+{callers.total - callers.callers.length} more</li>
          ) : null}
        </ul>
      </details>
    ) : null;

  const body = (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {streamingIndicator}
      {/* One brief, plain prose: summary (the delta) then whyMatters (the consequence) as a
          continuation sentence — not a labeled tinted box, which scan-readers skip. */}
      {summary || whyMatters ? (
        <p className="ml-[34px] m-0 text-[14px] leading-[21px]" style={{ textWrap: 'pretty' }}>
          {summary ? <span className="font-medium text-[var(--fg-1)]">{summary}</span> : null}
          {summary && whyMatters ? ' ' : ''}
          {whyMatters ? <span className="text-[var(--fg-2)]">{whyMatters}</span> : null}
        </p>
      ) : null}
      {callerDisclosure}
      {hasNarrationOverride && firstNarrativeIndex === -1 ? <NarrationBlock content="" chapterKey={id} /> : null}
      {chapter.sections.map((section, i) => {
        if (section.type === 'narrative') {
          if (i !== firstNarrativeIndex) return null;
          return <NarrationBlock key={i} content={section.content} chapterKey={id} />;
        }
        const flat = findHunk(files, section.file, section.hunkIndex, section.anchor);
        if (!flat) {
          return <MissingHunkBanner key={i} file={section.file} hunkIndex={section.hunkIndex} />;
        }
        const hunkKey = `${flat.file}:${flat.hunkIndex}`;
        const isDuplicate = priorHunks.has(hunkKey);
        const hunkCoversAll =
          section.startLine <= flat.hunk.newStart &&
          section.endLine >= flat.hunk.newStart + Math.max(flat.hunk.newCount - 1, 0);
        const highlight = hunkCoversAll ? undefined : { from: section.startLine, to: section.endLine };

        if (isDuplicate) {
          const ownerIdx = hunkOwners.get(hunkKey);
          const ownerLabel = ownerIdx !== undefined && ownerIdx !== index ? `Chapter ${ownerIdx + 1}` : 'earlier';
          return (
            <ReshowBlock key={i} ownerLabel={ownerLabel} warning="Duplicate primary — should be a reshow">
              <Hunk
                file={flat.file}
                hunk={flat.hunk}
                isNewFile={flat.isNewFile}
                hunkIndex={flat.hunkIndex}
                highlight={highlight}
              />
            </ReshowBlock>
          );
        }

        return (
          <Hunk
            key={i}
            file={flat.file}
            hunk={flat.hunk}
            isNewFile={flat.isNewFile}
            hunkIndex={flat.hunkIndex}
            highlight={highlight}
            resolve={annotationPlacement.bySection[i]?.resolve}
            callouts={annotationPlacement.bySection[i]?.callouts}
          />
        );
      })}
      {extraNarration.length > 0 && (
        <details className="ml-[34px] rounded-[8px] bg-[var(--gray-2)] px-3 py-2 text-[12.5px] text-[var(--fg-2)]">
          <summary className="cursor-pointer font-semibold text-[var(--fg-3)]">More context</summary>
          <div className="mt-3 space-y-3">
            {extraNarration.map((section, i) => (
              <NarrationBlock key={i} content={section.content} flush />
            ))}
          </div>
        </details>
      )}
      {chapter.reshow?.map((entry, i) => {
        const refFile = entry.file || refToFileFallback.get(entry.ref);
        if (!refFile) {
          return <MissingHunkBanner key={`reshow-${i}`} file="(unknown)" hunkIndex={entry.ref} kind="reshow" />;
        }
        const flat = findHunk(files, refFile, entry.ref);
        if (!flat) {
          return <MissingHunkBanner key={`reshow-${i}`} file={refFile} hunkIndex={entry.ref} kind="reshow" />;
        }
        const ownerIdx = hunkOwners.get(`${refFile}:${entry.ref}`);
        const ownerLabel = ownerIdx !== undefined && ownerIdx !== index ? `Chapter ${ownerIdx + 1}` : 'earlier';
        return (
          <ReshowBlock key={`reshow-${i}`} ownerLabel={ownerLabel} framing={entry.framing}>
            <Hunk
              file={flat.file}
              hunk={flat.hunk}
              isNewFile={flat.isNewFile}
              hunkIndex={entry.ref}
              highlight={entry.highlight}
            />
          </ReshowBlock>
        );
      })}
      {annotationPlacement.leftoverCallouts.length > 0 && (
        <CalloutList callouts={annotationPlacement.leftoverCallouts} />
      )}
      {annotationPlacement.leftoverResolve.length > 0 && (
        <div className="space-y-2">
          {annotationPlacement.leftoverResolve.map((item) => (
            <ResolveStrip key={item.id} item={item} />
          ))}
        </div>
      )}
      <NarrationAnchor chapterIndex={index} />
    </div>
  );

  const badgeStyle: React.CSSProperties = reviewed
    ? { background: 'var(--green-9)', color: '#fff' }
    : { background: 'var(--purple-9)', color: '#fff' };

  // OUTLINE STRUCTURE
  if (storyStructure === 'outline') {
    return (
      <section data-chid={id} className={`scroll-mt-[168px] ${compact ? 'mb-[18px]' : 'mb-[28px]'}`}>
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          aria-expanded={outlineOpen}
          className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg p-2 text-left hover:bg-[var(--gray-2)]"
        >
          <span
            className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--fg-3)] transition-transform ${
              outlineOpen ? 'rotate-90' : ''
            }`}
          >
            <IconChevron className="h-3.5 w-3.5" />
          </span>
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-bold"
            style={badgeStyle}
          >
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
              <span>{chapter.title}</span>
              {riskPill}
            </h2>
            <span className="mt-[2px] block text-[12px] text-[var(--fg-3)]">
              {hunkCount} {hunkCount === 1 ? 'hunk' : 'hunks'} · {commentCount}{' '}
              {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>
        </button>
        {outlineOpen && <div className="mt-[14px]">{body}</div>}
      </section>
    );
  }

  // LINEAR STRUCTURE
  if (storyStructure === 'linear') {
    return (
      <section data-chid={id} className={`scroll-mt-[168px] ${compact ? 'mb-[18px]' : 'mb-[32px]'}`}>
        <div className="mb-[16px] mt-[32px] grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <span className="h-px" style={{ background: 'var(--gray-a4)' }} />
          <h2 className="m-0 inline-flex items-center gap-[10px] whitespace-nowrap text-[17px] font-semibold tracking-[-0.005em] text-[var(--fg-1)]">
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--fg-3)]"
              style={{ background: 'var(--gray-3)' }}
            >
              Ch {index + 1}
            </span>
            {chapter.title}
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.05em]"
              style={{
                color:
                  chapter.risk === 'high'
                    ? 'var(--red-11)'
                    : chapter.risk === 'medium'
                      ? 'var(--amber-11)'
                      : 'var(--green-11)',
              }}
            >
              {chapter.risk}
            </span>
          </h2>
          <span className="h-px" style={{ background: 'var(--gray-a4)' }} />
        </div>
        {body}
      </section>
    );
  }

  // CHAPTERS (default) — collapsible, auto-collapses on review.
  return (
    <section data-chid={id} className={`scroll-mt-[168px] ${compact ? 'mb-[18px]' : 'mb-[28px]'}`}>
      <div
        className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 -ml-2 transition-colors hover:bg-[var(--gray-2)]"
        onClick={toggleCollapsed}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleCollapsed();
          }
        }}
      >
        <span
          className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--fg-3)] transition-transform duration-200 ease-out"
          style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
        >
          <IconChevron className="h-3.5 w-3.5" />
        </span>
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-bold transition-all duration-300"
          style={badgeStyle}
        >
          {reviewed ? <IconCheck className="h-[11px] w-[11px]" /> : index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)] transition-opacity duration-200">
            <span style={{ opacity: collapsed && reviewed ? 0.5 : 1 }}>{chapter.title}</span>
            {riskPill}
          </h2>
          <div
            className="grid transition-all duration-200 ease-out"
            style={{ gridTemplateRows: collapsed ? '1fr' : '0fr', opacity: collapsed ? 1 : 0 }}
          >
            <div className="overflow-hidden">
              <span className="mt-[2px] block text-[12px] text-[var(--fg-3)]">
                {hunkCount} {hunkCount === 1 ? 'hunk' : 'hunks'}
                {commentCount > 0 && (
                  <>
                    {' '}
                    · {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                  </>
                )}
                {reviewed && <> · reviewed</>}
              </span>
              {/* On the collapsed row, not inside the body: a reason you have to expand to read cannot
                  justify the collapse. */}
              {reasonLine ? (
                <span className="mt-[3px] block text-[12px]" style={{ color: 'var(--fg-3)' }} data-collapse-reason>
                  Collapsed — {reasonLine}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {reviewedButton}
      </div>
      <div
        className="grid transition-all duration-300 ease-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr', opacity: collapsed ? 0 : 1 }}
      >
        <div className="overflow-hidden">
          <div className={collapsed ? '' : 'mt-[10px]'}>{body}</div>
        </div>
      </div>
    </section>
  );
}
