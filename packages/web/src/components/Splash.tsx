import { useState } from "react";
import { copy } from "../lib/microcopy";

type Props = {
  onContinue: () => void;
};

const STEPS: { num: number; text: string }[] = [
  { num: 1, text: "CLI fetches the PR and generates a narrative" },
  { num: 2, text: "Browser opens with story-laid-out diff" },
  { num: 3, text: "Comments sync bidirectionally with GitHub" },
];

const CLI_COMMAND = "$ dad review <pr-number>";

export function Splash({ onContinue }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND.replace(/^\$\s*/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-8 shadow-2xl dark:bg-gray-900">
        <div className="flex items-center gap-4">
          <div
            className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-brand font-mono text-3xl font-bold text-white"
            style={{
              boxShadow:
                "0 8px 16px -4px rgba(91,33,182,0.35), 0 4px 8px -2px rgba(3,2,13,0.10)",
            }}
          >
            D
          </div>
          <div>
            <h1
              id="splash-title"
              className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-gray-900 dark:text-gray-50"
            >
              Diff Dad
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              A per-PR review tool that opens the diff as a story.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-gray-100 p-4 dark:bg-gray-800/60">
          <div className="flex items-center justify-between gap-3">
            <code className="font-mono text-sm text-gray-800 dark:text-gray-200">
              {CLI_COMMAND}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            e.g. <span className="font-mono">dad review 1847</span> opens this
            PR with a live event stream.
          </p>
        </div>

        <ol className="mt-6 space-y-3">
          {STEPS.map((step) => (
            <li key={step.num} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-xs font-bold text-brand">
                {step.num}
              </div>
              <p className="text-sm leading-snug text-gray-700 dark:text-gray-300">
                {step.text}
              </p>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={onContinue}
          className="mt-7 block w-full rounded-lg bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand/90"
        >
          Continue to review →
        </button>

        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
          {copy.tagline}
        </p>
      </div>
    </div>
  );
}
