import { useMemo, useState } from "react";
import { useReviewStore } from "../state/review-store";
import type { DiffHunk, PRComment } from "../state/types";
import { CodeLine } from "./CodeLine";
import { CommentThread } from "./CommentThread";
import { Comment } from "./Comment";
import { useHighlighter } from "../hooks/useHighlighter";
import { guessLang } from "../lib/shiki";

type Props = {
  file: string;
  hunk: DiffHunk;
  isNewFile?: boolean;
  hunkIndex: number;
};

const BOT_AVATAR_PALETTE = [
  "bg-brand",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
];

function botAvatarColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = (hash * 31 + author.charCodeAt(i)) | 0;
  }
  return (
    BOT_AVATAR_PALETTE[Math.abs(hash) % BOT_AVATAR_PALETTE.length] ?? "bg-brand"
  );
}

function botInitials(author: string): string {
  const cleaned = author.replace(/\[bot\]$/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

function botDisplayName(author: string): string {
  return author.replace(/\[bot\]$/, "");
}

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
        <span className="text-brand">💬</span>
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
  const displayNames = uniqueAuthors.map(botDisplayName);
  const namesLabel =
    displayNames.length <= 2
      ? displayNames.join(", ")
      : `${displayNames.slice(0, 2).join(", ")} +${displayNames.length - 2}`;
  const count = comments.length;

  return (
    <div className="border-b border-gray-200 bg-brand/5 px-3 py-2 dark:border-gray-800 dark:bg-brand/10">
      <div className="flex items-center gap-2">
        <div className="flex">
          {avatarStack.map((author, idx) => (
            <div
              key={author}
              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white dark:border-gray-900 ${botAvatarColor(author)}`}
              style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: 10 - idx }}
              title={botDisplayName(author)}
            >
              {botInitials(author)}
            </div>
          ))}
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

export function Hunk({ file, hunk, isNewFile, hunkIndex }: Props) {
  const openLine = useReviewStore((s) => s.openLine);
  const comments = useReviewStore((s) => s.comments);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const headSha = useReviewStore((s) => s.pr?.headSha ?? null);
  useHighlighter();
  const lang = guessLang(file);

  const range = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

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
    <div className="my-3 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm dark:border-gray-800 dark:bg-gray-900/60">
        <span className="font-semibold text-gray-800 dark:text-gray-200">
          {file}
        </span>
        <span className="text-gray-400 dark:text-gray-500">{range}</span>
        {isNewFile ? (
          <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
            New
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View on GitHub"
              aria-label="View on GitHub"
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              GitHub
            </a>
          )}
          <a
            href={editorUrl}
            title="Open in editor"
            aria-label="Open in editor"
            className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            Editor
          </a>
        </div>
      </div>
      {botComments.length > 0 && (
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
              !/\[bot\]$/.test(c.author),
          );
          const hasThread = openLine === lineKey || lineComments.length > 0;
          return (
            <div key={lineKey}>
              <CodeLine line={line} lineKey={lineKey} lang={lang} />
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
