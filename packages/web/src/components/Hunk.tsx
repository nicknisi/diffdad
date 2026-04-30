import { useMemo, useState } from "react";
import { useReviewStore } from "../state/review-store";
import type { DiffHunk, PRComment } from "../state/types";
import { CodeLine } from "./CodeLine";
import { CommentThread } from "./CommentThread";
import { Comment } from "./Comment";
import { useHighlighter } from "../hooks/useHighlighter";
import { guessLang } from "../lib/shiki";
import { getAuthorInfo } from "../lib/authors";
import { IconArrowRight, IconChat, IconFile, IconGitHub } from "./Icons";

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
  lineKey,
  isNewThread,
  onClose,
}: {
  comments: PRComment[];
  file: string;
  lineNumber: number | undefined;
  lineKey: string;
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
        className="flex w-full items-center gap-2 border-l-2 border-brand/40 bg-gray-50 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:bg-gray-900/40 dark:hover:bg-gray-800"
      >
        <IconChat className="h-3.5 w-3.5 text-brand" />
        {count} {count === 1 ? "comment" : "comments"} — click to expand
      </button>
    );
  }

  return (
    <div className="border-l-2 border-brand bg-gray-50 px-3 py-3 dark:bg-gray-900/60">
      {count > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="mb-2 text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          Collapse {count} {count === 1 ? "comment" : "comments"}
        </button>
      )}
      <CommentThread
        comments={comments}
        path={file}
        line={lineNumber}
        onClose={onClose}
        autoFocus={isNewThread}
      />
    </div>
  );
}

function BotCluster({
  comments,
  file,
}: {
  comments: PRComment[];
  file: string;
}) {
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
  const displayNames = uniqueAuthors.map(
    (a) => getAuthorInfo(a).displayName,
  );
  const namesLabel =
    displayNames.length <= 2
      ? displayNames.join(", ")
      : `${displayNames.slice(0, 2).join(", ")} +${displayNames.length - 2}`;
  const count = comments.length;

  return (
    <div className="border-b border-gray-200 bg-brand/5 px-3 py-2 dark:border-gray-800 dark:bg-brand/10">
      <div className="flex items-center gap-2">
        <div className="flex">
          {avatarStack.map((author, idx) => {
            const info = getAuthorInfo(author);
            return (
              <div
                key={author}
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white dark:border-gray-900"
                style={{
                  marginLeft: idx === 0 ? 0 : -8,
                  zIndex: 10 - idx,
                  background: info.color,
                }}
                title={info.displayName}
              >
                {info.initials}
              </div>
            );
          })}
        </div>
        <span className="text-sm">
          <span className="font-semibold text-brand">
            {count} bot {count === 1 ? "suggestion" : "suggestions"}
          </span>
          <span className="text-gray-500 dark:text-gray-400"> from </span>
          <span className="text-gray-600 dark:text-gray-300">
            {namesLabel}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs font-medium text-brand hover:underline"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="space-y-1">
              {c.line !== undefined && (
                <div className="text-xs font-mono text-gray-500 dark:text-gray-400">
                  {file}:L{c.line}
                </div>
              )}
              <Comment comment={c} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Hunk({ file, hunk, isNewFile, hunkIndex, highlight }: Props) {
  const openLine = useReviewStore((s) => s.openLine);
  const comments = useReviewStore((s) => s.comments);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const headSha = useReviewStore((s) => s.pr?.headSha ?? null);
  const clusterBots = useReviewStore((s) => s.clusterBots);
  useHighlighter();
  const lang = guessLang(file);

  const rangeStart = hunk.oldStart;
  const rangeEnd = hunk.oldStart + Math.max(hunk.oldCount, 0);
  const range = `L${rangeStart}–L${rangeEnd}`;

  const hunkStart = hunk.newStart;
  const hunkEnd = hunk.newStart + Math.max(hunk.newCount - 1, 0);

  // Bot comments scoped to this hunk's line range and file
  const botComments = useMemo(() => {
    return comments.filter((c) => {
      if (c.path !== file) return false;
      if (!/\[bot\]$/.test(c.author)) return false;
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
    <div className="my-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 font-mono text-[12.5px]">
        <IconFile className="h-[12px] w-[12px] flex-shrink-0 text-[var(--fg-3)]" />
        <span className="font-semibold text-[var(--fg-1)]">{file}</span>
        <span className="text-[var(--fg-3)]">{range}</span>
        {isNewFile ? (
          <span className="ml-1 rounded-[4px] bg-green-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-green-700 dark:bg-green-900/40 dark:text-green-300">
            New
          </span>
        ) : null}
        {highlight ? (
          <span className="ml-1 rounded-[4px] bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10.5px] font-medium font-mono text-[var(--brand)]">
            focus L{highlight.from}–L{highlight.to}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <a
            href={editorUrl}
            title="Open in editor"
            aria-label="Open in editor"
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] text-[var(--fg-3)] hover:bg-[var(--border)] hover:text-[var(--fg-1)]"
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
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] text-[var(--fg-3)] hover:bg-[var(--border)] hover:text-[var(--fg-1)]"
            >
              <IconGitHub className="h-[11px] w-[11px]" />
            </a>
          )}
        </div>
      </div>
      {clusterBots && botComments.length > 0 && (
        <BotCluster comments={botComments} file={file} />
      )}
      <div>
        {hunk.lines.map((line, i) => {
          const lineKey = `${file}:${hunkIndex}:${i}`;
          const lineComments: PRComment[] = comments.filter(
            (c) =>
              c.path === file &&
              c.line !== undefined &&
              line.lineNumber.new !== undefined &&
              c.line === line.lineNumber.new &&
              (clusterBots ? !/\[bot\]$/.test(c.author) : true),
          );
          const hasThread = openLine === lineKey || lineComments.length > 0;
          const dimmed =
            highlight !== undefined &&
            (line.lineNumber.new === undefined ||
              line.lineNumber.new < highlight.from ||
              line.lineNumber.new > highlight.to);
          return (
            <div key={lineKey}>
              <CodeLine
                line={line}
                lineKey={lineKey}
                lang={lang}
                dimmed={dimmed}
              />
              {hasThread && (
                <CollapsibleThread
                  comments={lineComments}
                  file={file}
                  lineNumber={line.lineNumber.new}
                  lineKey={lineKey}
                  isNewThread={openLine === lineKey && lineComments.length === 0}
                  onClose={() =>
                    openLine === lineKey ? setOpenLine(null) : undefined
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
