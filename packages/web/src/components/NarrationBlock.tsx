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
        className={`${margin} block text-sm italic text-[var(--fg-3)] hover:text-[var(--fg-1)]`}
      >
        AI narration (click to expand)
      </button>
    );
  }

  return (
    <div
      className={`${margin} max-w-prose text-[14.5px] leading-[22px] text-[var(--fg-1)]`}
      style={{ textWrap: "pretty" }}
    >
      <Markdown source={content} />
    </div>
  );
}
