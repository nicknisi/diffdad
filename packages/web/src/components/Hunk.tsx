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

export function Hunk({ file, hunk, isNewFile, hunkIndex }: Props) {
  const openLine = useReviewStore((s) => s.openLine);
  const comments = useReviewStore((s) => s.comments);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  useHighlighter();
  const lang = guessLang(file);

  const range = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[13px] dark:border-gray-800 dark:bg-gray-900/60">
        <span className="font-semibold text-gray-800 dark:text-gray-200">
          {file}
        </span>
        <span className="text-gray-400 dark:text-gray-500">{range}</span>
        {isNewFile ? (
          <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            New
          </span>
        ) : null}
      </div>
      <div className="divide-y divide-transparent">
        {hunk.lines.map((line, i) => {
          const lineKey = `${file}:${hunkIndex}:${i}`;
          const lineComments: PRComment[] = comments.filter(
            (c) =>
              c.path === file &&
              c.line !== undefined &&
              line.lineNumber.new !== undefined &&
              c.line === line.lineNumber.new,
          );
          return (
            <div key={lineKey}>
              <CodeLine line={line} lineKey={lineKey} lang={lang} />
              {(openLine === lineKey || lineComments.length > 0) && (
                <div className="border-l-2 border-brand bg-gray-50 px-3 py-3 dark:bg-gray-900/60">
                  <CommentThread
                    comments={lineComments}
                    path={file}
                    line={line.lineNumber.new}
                    onClose={() =>
                      openLine === lineKey ? setOpenLine(null) : null
                    }
                    autoFocus={openLine === lineKey}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
