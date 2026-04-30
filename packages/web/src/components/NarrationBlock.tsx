import { useState } from "react";
import { useReviewStore } from "../state/review-store";
import { Markdown } from "./markdown/Markdown";

type Props = {
  content: string;
};

export function NarrationBlock({ content }: Props) {
  const collapseNarration = useReviewStore((s) => s.collapseNarration);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  const compact = displayDensity === "compact";
  const margin = compact ? "ml-[28px]" : "ml-[34px]";

  const [expanded, setExpanded] = useState(false);

  if (collapseNarration && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`${margin} block text-sm italic text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200`}
      >
        AI narration (click to expand)
      </button>
    );
  }

  return (
    <div className={`${margin} text-base leading-relaxed text-gray-700 dark:text-gray-300`}>
      <Markdown source={content} />
    </div>
  );
}
