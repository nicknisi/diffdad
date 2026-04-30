import { useMemo } from "react";
import { useReviewStore } from "../state/review-store";
import type { DiffLine } from "../state/types";
import { highlightLine } from "../lib/shiki";
import { IconPlus } from "./Icons";

type Props = {
  line: DiffLine;
  lineKey: string;
  lang: string;
  dimmed?: boolean;
};

export function CodeLine({ line, lineKey, lang, dimmed }: Props) {
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const theme = useReviewStore((s) => s.theme);

  const sign =
    line.type === "add" ? "+" : line.type === "remove" ? "−" : " ";

  const rowBg =
    line.type === "add"
      ? "bg-green-50 dark:bg-green-950/40"
      : line.type === "remove"
        ? "bg-red-50 dark:bg-red-950/40"
        : "bg-white dark:bg-gray-900";

  const lineNumColor =
    line.type === "add"
      ? "text-green-600/60 dark:text-green-400/50"
      : line.type === "remove"
        ? "text-red-600/60 dark:text-red-400/50"
        : "text-gray-400 dark:text-gray-600";

  const signBg =
    line.type === "add"
      ? "bg-green-100/80 text-green-700 dark:bg-green-900/50 dark:text-green-300"
      : line.type === "remove"
        ? "bg-red-100/80 text-red-700 dark:bg-red-900/50 dark:text-red-300"
        : "text-gray-400 dark:text-gray-600";

  // Shiki output is spans with inline style="color:..." — all content is escapeHtml'd in highlightLine
  const highlighted = useMemo(
    () => highlightLine(line.content, lang, theme),
    [line.content, lang, theme],
  );

  return (
    <div
      className={`group relative flex font-mono text-sm leading-snug ${rowBg}${dimmed ? " opacity-40" : ""}`}
    >
      <div className={`w-12 select-none px-2 text-right ${lineNumColor}`}>
        {line.lineNumber.old ?? ""}
      </div>
      <div className={`w-12 select-none px-2 text-right ${lineNumColor}`}>
        {line.lineNumber.new ?? ""}
      </div>
      <div className={`relative w-6 select-none text-center ${signBg}`}>
        {sign}
        <button
          type="button"
          aria-label="Comment on line"
          onClick={() => setOpenLine(lineKey)}
          className="invisible absolute -right-3 top-0 flex h-5 w-5 items-center justify-center rounded-[4px] bg-brand text-white shadow-sm group-hover:visible"
        >
          <IconPlus className="h-3 w-3" />
        </button>
      </div>
      {highlighted ? (
        <pre
          className="flex-1 overflow-x-auto whitespace-pre px-4"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="flex-1 overflow-x-auto whitespace-pre px-4 text-gray-800 dark:text-gray-200">
          {line.content}
        </pre>
      )}
    </div>
  );
}
