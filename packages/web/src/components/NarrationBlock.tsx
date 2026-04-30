import { useState } from "react";
import { useReviewStore } from "../state/review-store";
import { Markdown } from "./markdown/Markdown";

type Props = {
  content: string;
};

export function NarrationBlock({ content }: Props) {
  const collapseNarration = useReviewStore((s) => s.collapseNarration);

  const [expanded, setExpanded] = useState(false);

  if (collapseNarration && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ml-[34px] block text-sm italic text-[var(--fg-3)] hover:text-[var(--fg-1)]"
      >
        AI narration (click to expand)
      </button>
    );
  }

  return (
    <p
      className="m-0 ml-[34px] mb-[16px] text-[14.5px] leading-[22px] text-[var(--fg-1)] narration-prose"
      style={{ textWrap: "pretty" }}
    >
      <Markdown source={content} />
    </p>
  );
}
