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
  isNewThread,
  onClose,
}: {
  comments: PRComment[];
  file: string;
  lineNumber: number | undefined;
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
          boxShadow:
            "inset 0 1px 0 var(--gray-a4), inset 0 -1px 0 var(--gray-a4)",
        }}
      >
        <IconChat className="h-3.5 w-3.5" style={{ color: "var(--purple-11)" }} />
        {count} {count === 1 ? "comment" : "comments"} — click to expand
      </button>
    );
  }

  return (
    <div
      className="bg-[var(--gray-2)] px-[12px] pt-[10px] pb-[12px] pl-[78px]"
      style={{
        boxShadow:
          "inset 0 1px 0 var(--gray-a4), inset 0 -1px 0 var(--gray-a4)",
      }}
    >
      {count > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="mb-1 text-[11px] font-medium text-[var(--fg-3)] hover:text-[var(--fg-1)]"
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
    <div
      className="mx-3 my-1.5 overflow-hidden rounded-[6px] border border-dashed transition-colors"
      style={{
        borderColor: "var(--purple-a5)",
        background: expanded ? "var(--bg-panel)" : "var(--purple-2)",
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
                  boxShadow: "0 0 0 2px var(--bg-panel)",
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
            {count} bot {count === 1 ? "suggestion" : "suggestions"}
          </b>
          <span className="text-[11.5px] font-normal text-[var(--fg-3)]">
            from {namesLabel}
          </span>
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium"
          style={{ color: "var(--purple-11)" }}
        >
          {expanded ? "Collapse" : "Expand"}
          <svg
            className={`h-[11px] w-[11px] transition-transform ${expanded ? "rotate-90" : ""}`}
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
        <div
          className="border-t border-dashed bg-[var(--bg-panel)] py-1.5"
          style={{ borderColor: "var(--purple-a5)" }}
        >
          {comments.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[56px_1fr] items-start gap-2.5 px-3 py-1.5"
            >
              <div
                className="pt-1.5 text-right font-mono text-[11.5px] font-medium"
                style={{ color: "var(--fg-3)" }}
              >
                L{c.line ?? ""}
              </div>
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
    <div
      className="ml-[34px] mb-[14px] overflow-hidden rounded-[8px] bg-[var(--bg-panel)]"
      style={{ boxShadow: "inset 0 0 0 1px var(--gray-a5)" }}
    >
      <div
        className="flex items-center gap-2 bg-[var(--gray-2)] px-3 py-2 font-mono text-[12.5px] text-[var(--fg-2)]"
        style={{ boxShadow: "inset 0 -1px 0 var(--gray-a4)" }}
      >
        <IconFile className="h-[12px] w-[12px] flex-shrink-0 text-[var(--fg-3)]" />
        <span className="font-semibold text-[var(--fg-1)]">{file}</span>
        <span className="text-[var(--fg-3)]">{range}</span>
        {isNewFile ? (
          <span
            className="ml-1.5 rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{
              background: "var(--green-3)",
              color: "var(--green-11)",
            }}
          >
            New file
          </span>
        ) : null}
        {highlight ? (
          <span
            className="ml-1.5 rounded-[3px] px-1.5 py-px font-mono text-[10.5px] font-medium"
            style={{
              background: "var(--purple-3)",
              color: "var(--purple-11)",
              boxShadow: "inset 0 0 0 1px var(--purple-a4)",
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
