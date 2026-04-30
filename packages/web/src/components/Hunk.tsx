import { useState } from "react";
import { useReviewStore } from "../state/review-store";
import type { DiffHunk, PRComment } from "../state/types";
import { CodeLine } from "./CodeLine";
import { CommentThread } from "./CommentThread";
import { useHighlighter } from "../hooks/useHighlighter";
import { guessLang } from "../lib/shiki";

type Props = {
  file: string;
  hunk: DiffHunk;
  isNewFile?: boolean;
  hunkIndex: number;
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

export function Hunk({ file, hunk, isNewFile, hunkIndex }: Props) {
  const openLine = useReviewStore((s) => s.openLine);
  const comments = useReviewStore((s) => s.comments);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  useHighlighter();
  const lang = guessLang(file);

  const range = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

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
      </div>
      <div>
        {hunk.lines.map((line, i) => {
          const lineKey = `${file}:${hunkIndex}:${i}`;
          const lineComments: PRComment[] = comments.filter(
            (c) =>
              c.path === file &&
              c.line !== undefined &&
              line.lineNumber.new !== undefined &&
              c.line === line.lineNumber.new,
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
