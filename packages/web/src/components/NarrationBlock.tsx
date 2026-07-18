import { useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { Markdown } from './markdown/Markdown';

type Props = {
  content: string;
  chapterKey?: string;
  flush?: boolean;
};

export function NarrationBlock({ content, chapterKey, flush = false }: Props) {
  const collapseNarration = useReviewStore((s) => s.collapseNarration);
  const narrationOverrides = useReviewStore((s) => s.narrationOverrides);

  const [expanded, setExpanded] = useState(false);

  const displayText = (chapterKey && narrationOverrides[chapterKey]) || content;

  if (collapseNarration && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`${flush ? '' : 'ml-[34px] '}block text-sm italic text-[var(--fg-3)] hover:text-[var(--fg-1)]`}
      >
        AI narration (click to expand)
      </button>
    );
  }

  return (
    <div
      className={`m-0 mb-[16px] text-[14.5px] leading-[22px] text-[var(--fg-1)] narration-prose ${flush ? '' : 'ml-[34px]'}`}
      style={{ textWrap: 'pretty' }}
    >
      <Markdown source={displayText} />
    </div>
  );
}
