import { useEffect, useState } from 'react';
import { getAccentMeta } from '../lib/accents';
import { useReviewStore } from '../state/review-store';
import { copy } from '../lib/microcopy';
import { DadMark } from './DadMark';

/**
 * "Dad is reading" indicator for a unit still under review / hydrating — so opening one mid-review
 * isn't a dead, silent screen. Reuses the same generating-* keyframes (and rotating loadingMessages)
 * as the PR-mode GeneratingScreen, so the daemon feels like the same product.
 */
export function ReviewProgress({ label }: { label?: string }) {
  const accent = useReviewStore((s) => s.accent);
  const { markBg } = getAccentMeta(accent);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (label) return; // a fixed label doesn't rotate
    const id = setInterval(() => setI((n) => (n + 1) % copy.loadingMessages.length), 2500);
    return () => clearInterval(id);
  }, [label]);

  return (
    <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-6 pt-6">
      <div style={{ animation: 'generating-bob 2s ease-in-out infinite' }}>
        <DadMark size={30} bg={markBg} shape="circle" showBadge={false} showWink />
      </div>
      <div className="flex gap-1">
        {[0, 0.2, 0.4].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--purple-9)', animation: `generating-dot 1.4s ease-in-out ${d}s infinite` }}
          />
        ))}
      </div>
      <p
        className="text-[13.5px] italic text-[var(--fg-2)]"
        style={{ animation: 'generating-fade 2.5s ease-in-out infinite' }}
      >
        {label ?? copy.loadingMessages[i]}
      </p>
    </div>
  );
}
