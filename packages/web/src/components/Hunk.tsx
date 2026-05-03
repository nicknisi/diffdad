import { useCallback, useMemo, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import type { DiffHunk, PRComment } from '../state/types';
import { CodeLine } from './CodeLine';
import { CommentThread } from './CommentThread';
import { Comment } from './Comment';
import { guessLang } from '../lib/shiki';
import { getAuthorInfo } from '../lib/authors';
import { normalizePath } from '../lib/paths';
import { IconArrowRight, IconChat, IconFile, IconGitHub } from './Icons';

type Props = {
  file: string;
  hunk: DiffHunk;
  isNewFile?: boolean;
  hunkIndex: number;
  highlight?: { from: number; to: number };
};

function CollapsibleThread({
  comments,
  file,
  lineNumber,
  side,
  isNewThread,
  onClose,
}: {
  comments: PRComment[];
  file: string;
  lineNumber: number | undefined;
  side: 'LEFT' | 'RIGHT';
  isNewThread: boolean;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const count = comments.length;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center gap-2 bg-[var(--gray-2)] px-[12px] py-[6px] pl-[78px] text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
        style={{
          boxShadow: 'inset 0 1px 0 var(--gray-a4), inset 0 -1px 0 var(--gray-a4)',
        }}
      >
        <IconChat className="h-3.5 w-3.5 text-[var(--purple-11)]" />
        {count} {count === 1 ? 'comment' : 'comments'} — click to expand
      </button>
    );
  }

  return (
    <div
      className="bg-[var(--gray-2)] px-[12px] pt-[10px] pb-[12px] pl-[78px]"
      style={{
        boxShadow: 'inset 0 1px 0 var(--gray-a4), inset 0 -1px 0 var(--gray-a4)',
      }}
    >
      {count > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="mb-1 text-[11px] font-medium text-[var(--fg-3)] hover:text-[var(--fg-1)]"
        >
          Collapse {count} {count === 1 ? 'comment' : 'comments'}
        </button>
      )}
      <CommentThread
        comments={comments}
        path={file}
        line={lineNumber}
        side={side}
        onClose={onClose}
        autoFocus={isNewThread}
      />
    </div>
  );
}

function BotCluster({ comments }: { comments: PRComment[] }) {
  const [expanded, setExpanded] = useState(false);

  const uniqueAuthors = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const c of comments) {
      if (!seen.has(c.author)) {
        seen.add(c.author);
        ordered.push(c.author);
      }
    }
    return ordered;
  }, [comments]);

  const avatarStack = uniqueAuthors.slice(0, 3);
  const displayNames = uniqueAuthors.map((a) => getAuthorInfo(a).displayName);
  const namesLabel =
    displayNames.length <= 2
      ? displayNames.join(', ')
      : `${displayNames.slice(0, 2).join(', ')} +${displayNames.length - 2}`;
  const count = comments.length;

  return (
    <div
      className="mx-3 my-1.5 overflow-hidden rounded-[6px] border border-dashed transition-colors"
      style={{
        borderColor: 'var(--purple-a5)',
        background: expanded ? 'var(--bg-panel)' : 'var(--purple-2)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-[var(--fg-1)] hover:bg-[var(--purple-3)]"
      >
        <span className="relative inline-flex">
          {avatarStack.map((author, idx) => {
            const info = getAuthorInfo(author);
            return (
              <span
                key={author}
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9.5px] font-bold text-white"
                style={{
                  marginLeft: idx === 0 ? 0 : -8,
                  zIndex: 10 - idx,
                  background: info.color,
                  boxShadow: '0 0 0 2px var(--bg-panel)',
                }}
                title={info.displayName}
              >
                {info.initials}
              </span>
            );
          })}
        </span>
        <span className="flex flex-col text-[13px] leading-tight">
          <b className="font-medium">
            {count} bot {count === 1 ? 'suggestion' : 'suggestions'}
          </b>
          <span className="text-[11.5px] font-normal text-[var(--fg-3)]">from {namesLabel}</span>
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium"
          style={{ color: 'var(--purple-11)' }}
        >
          {expanded ? 'Collapse' : 'Expand'}
          <svg
            className={`h-[11px] w-[11px] transition-transform ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <path d="M5.5 3L10 7.5 5.5 12" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-dashed bg-[var(--bg-panel)] py-1.5" style={{ borderColor: 'var(--purple-a5)' }}>
          {comments.map((c) => (
            <div key={c.id} className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-2.5 px-3 py-1.5">
              <div className="pt-1.5 text-right font-mono text-[11.5px] font-medium" style={{ color: 'var(--fg-3)' }}>
                L{c.line ?? ''}
              </div>
              <Comment comment={c} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const FOLD_CONTEXT = 2;
const FOLD_MIN = 4;

type LineGroup = { kind: 'lines'; indices: number[] } | { kind: 'fold'; indices: number[]; count: number };

function buildLineGroups(
  lines: DiffHunk['lines'],
  highlight: Props['highlight'],
  commentLineSet: Set<number>,
  openLineKeys: Set<string>,
  file: string,
  hunkIndex: number,
): LineGroup[] {
  if (!highlight) {
    return [{ kind: 'lines', indices: lines.map((_, i) => i) }];
  }

  const pinned = new Set<number>();
  lines.forEach((line, i) => {
    const ln = line.lineNumber.new;
    if (ln !== undefined && ln >= highlight.from && ln <= highlight.to) {
      pinned.add(i);
    }
    if (commentLineSet.has(i) || openLineKeys.has(`${file}:${hunkIndex}:${i}`)) {
      pinned.add(i);
    }
  });

  // Expand context around pinned lines
  const visible = new Set<number>();
  for (const idx of pinned) {
    for (let j = idx - FOLD_CONTEXT; j <= idx + FOLD_CONTEXT; j++) {
      if (j >= 0 && j < lines.length) visible.add(j);
    }
  }

  const groups: LineGroup[] = [];
  let foldBuf: number[] = [];

  function flushFold() {
    if (foldBuf.length === 0) return;
    if (foldBuf.length < FOLD_MIN) {
      groups.push({ kind: 'lines', indices: [...foldBuf] });
    } else {
      groups.push({ kind: 'fold', indices: [...foldBuf], count: foldBuf.length });
    }
    foldBuf = [];
  }

  let lineBuf: number[] = [];
  function flushLines() {
    if (lineBuf.length === 0) return;
    groups.push({ kind: 'lines', indices: [...lineBuf] });
    lineBuf = [];
  }

  for (let i = 0; i < lines.length; i++) {
    if (visible.has(i)) {
      flushFold();
      lineBuf.push(i);
    } else {
      flushLines();
      foldBuf.push(i);
    }
  }
  flushLines();
  flushFold();

  return groups;
}

function FoldedLines({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-2 py-[3px] pl-[78px] text-[11.5px] font-medium hover:bg-[var(--gray-a3)]"
      style={{ color: 'var(--fg-3)' }}
    >
      <svg className="h-[10px] w-[10px]" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M3 5.5h9M3 9.5h9" />
      </svg>
      {count} lines hidden — click to expand
    </button>
  );
}

function HunkLines({
  file,
  hunk,
  hunkIndex,
  lang,
  highlight,
  comments,
  openLine,
  setOpenLine,
  clusterBots,
  commentsEnabled,
}: {
  file: string;
  hunk: DiffHunk;
  hunkIndex: number;
  lang: string;
  highlight: Props['highlight'];
  comments: PRComment[];
  openLine: string | null;
  setOpenLine: (key: string | null) => void;
  clusterBots: boolean;
  commentsEnabled: boolean;
}) {
  const normFile = normalizePath(file);

  // Map<commentId, lineIndex> — resolves each comment to one row in the hunk.
  // A comment posted on a change in GitHub can land on the unchanged line just
  // above the removal/addition because the side+line pair still matches the
  // context line at the same blob position. Push the anchor down to the change
  // so the thread renders below the changed line, matching GitHub's view.
  const commentLineMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of comments) {
      if (normalizePath(c.path) !== normFile) continue;
      if (c.line === undefined) continue;
      if (clusterBots && c.author.endsWith('[bot]')) continue;
      const isLeft = c.side === 'LEFT';
      let matchIdx = -1;
      for (let i = 0; i < hunk.lines.length; i++) {
        const ln = hunk.lines[i]!.lineNumber;
        const hit = isLeft ? ln.old === c.line : ln.new === c.line;
        if (!hit) continue;
        const isContext = hunk.lines[i]!.type === 'context';
        const next = hunk.lines[i + 1];
        if (isContext && next && next.type !== 'context') {
          matchIdx = i + 1;
        } else {
          matchIdx = i;
        }
        break;
      }
      if (matchIdx !== -1) map.set(c.id, matchIdx);
    }
    return map;
  }, [hunk.lines, comments, normFile, clusterBots]);

  const commentLineIndices = useMemo(() => new Set(commentLineMap.values()), [commentLineMap]);

  const openLineKeys = useMemo(() => {
    const set = new Set<string>();
    if (openLine) set.add(openLine);
    return set;
  }, [openLine]);

  const initialGroups = useMemo(
    () => buildLineGroups(hunk.lines, highlight, commentLineIndices, openLineKeys, file, hunkIndex),
    [hunk.lines, highlight, commentLineIndices, openLineKeys, file, hunkIndex],
  );

  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(() => new Set());

  const expandFold = useCallback((groupIdx: number) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      next.add(groupIdx);
      return next;
    });
  }, []);

  const renderLine = useCallback(
    (i: number, dimmed: boolean) => {
      const line = hunk.lines[i]!;
      const lineKey = `${file}:${hunkIndex}:${i}`;
      const lineComments: PRComment[] = comments.filter((c) => commentLineMap.get(c.id) === i);
      const hasThread = openLine === lineKey || lineComments.length > 0;
      return (
        <div key={lineKey}>
          <CodeLine line={line} lineKey={lineKey} lang={lang} dimmed={dimmed} />
          {hasThread && commentsEnabled && (
            <div className="sticky left-0" style={{ width: '100cqw' }}>
              <CollapsibleThread
                comments={lineComments}
                file={file}
                lineNumber={line.type === 'remove' ? line.lineNumber.old : line.lineNumber.new}
                side={line.type === 'remove' ? 'LEFT' : 'RIGHT'}
                isNewThread={openLine === lineKey && lineComments.length === 0}
                onClose={() => (openLine === lineKey ? setOpenLine(null) : undefined)}
              />
            </div>
          )}
        </div>
      );
    },
    [hunk.lines, file, hunkIndex, comments, commentLineMap, openLine, setOpenLine, lang],
  );

  return (
    <div style={{ minWidth: 'max-content' }}>
      {initialGroups.map((group, gi) => {
        if (group.kind === 'lines') {
          return group.indices.map((i) => renderLine(i, false));
        }
        if (expandedFolds.has(gi)) {
          return group.indices.map((i) => renderLine(i, true));
        }
        return (
          <div key={`fold-${gi}`} className="sticky left-0" style={{ width: '100cqw' }}>
            <FoldedLines count={group.count} onExpand={() => expandFold(gi)} />
          </div>
        );
      })}
    </div>
  );
}

export function Hunk({ file, hunk, isNewFile, hunkIndex, highlight }: Props) {
  const openLine = useReviewStore((s) => s.openLine);
  const comments = useReviewStore((s) => s.comments);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const mode = useReviewStore((s) => s.mode);
  const commentsEnabled = mode !== 'watch';
  const headSha = useReviewStore((s) => s.pr?.headSha ?? null);
  const clusterBots = useReviewStore((s) => s.clusterBots);
  const lang = guessLang(file);

  const rangeStart = hunk.oldStart;
  const rangeEnd = hunk.oldStart + Math.max(hunk.oldCount, 0);
  const range = `L${rangeStart}–L${rangeEnd}`;

  const hunkStart = hunk.newStart;
  const hunkEnd = hunk.newStart + Math.max(hunk.newCount - 1, 0);

  // Bot comments scoped to this hunk's line range and file
  const botComments = useMemo(() => {
    const normFile = normalizePath(file);
    return comments.filter((c) => {
      if (normalizePath(c.path) !== normFile) return false;
      if (!c.author.endsWith('[bot]')) return false;
      if (c.line === undefined) return false;
      return c.line >= hunkStart && c.line <= hunkEnd;
    });
  }, [comments, file, hunkStart, hunkEnd]);

  const githubUrl =
    repoUrl && headSha
      ? `${repoUrl}/blob/${headSha}/${file}#L${hunk.newStart}-L${hunk.newStart + hunk.newCount}`
      : null;
  const editorUrl = `vscode://file/${file}:${hunk.newStart}`;

  return (
    <div
      className="ml-[34px] mb-[14px] overflow-hidden rounded-[8px] bg-[var(--bg-panel)]"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      <div
        className="flex items-center gap-2 bg-[var(--gray-2)] px-3 py-2 font-mono text-[12.5px] text-[var(--fg-2)]"
        style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        <IconFile className="h-[12px] w-[12px] flex-shrink-0 text-[var(--fg-3)]" />
        <span className="font-semibold text-[var(--fg-1)]">{file}</span>
        <span className="text-[var(--fg-3)]">{range}</span>
        {isNewFile ? (
          <span
            className="ml-1.5 rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{
              background: 'var(--green-3)',
              color: 'var(--green-11)',
            }}
          >
            New file
          </span>
        ) : null}
        {highlight ? (
          <span
            className="ml-1.5 rounded-[3px] px-1.5 py-px font-mono text-[10.5px] font-medium"
            style={{
              background: 'var(--purple-3)',
              color: 'var(--purple-11)',
              boxShadow: 'inset 0 0 0 1px var(--purple-a4)',
            }}
          >
            focus L{highlight.from}–L{highlight.to}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <a
            href={editorUrl}
            title="Open in editor"
            aria-label="Open in editor"
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] text-[var(--fg-3)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
          >
            <IconArrowRight className="h-[11px] w-[11px]" />
          </a>
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View on GitHub"
              aria-label="View on GitHub"
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] text-[var(--fg-3)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
            >
              <IconGitHub className="h-[11px] w-[11px]" />
            </a>
          )}
        </div>
      </div>
      {clusterBots && botComments.length > 0 && <BotCluster comments={botComments} />}
      <div className="overflow-x-auto" style={{ containerType: 'inline-size' }}>
        <HunkLines
          file={file}
          hunk={hunk}
          hunkIndex={hunkIndex}
          lang={lang}
          highlight={highlight}
          comments={comments}
          openLine={openLine}
          setOpenLine={setOpenLine}
          clusterBots={clusterBots}
          commentsEnabled={commentsEnabled}
        />
      </div>
    </div>
  );
}
