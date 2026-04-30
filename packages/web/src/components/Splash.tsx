import { useState } from "react";
import { copy } from "../lib/microcopy";
import { IconArrowRight } from "./Icons";

type Props = {
  onContinue: () => void;
};

const STEPS: { num: number; text: string; code?: string }[] = [
  {
    num: 1,
    text: "CLI subscribes to ",
    code: "GitHub webhooks",
  },
  {
    num: 2,
    text: "Browser opens with story-laid-out diff",
  },
  {
    num: 3,
    text: "Comments, commits, CI all stream in live",
  },
];

const CLI_COMMAND = "dad review <pr-number>";

export function Splash({ onContinue }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      className="fixed inset-0 z-50 grid place-items-center px-5"
      style={{
        background:
          "radial-gradient(circle at 20% 0%, var(--purple-3), transparent 50%), radial-gradient(circle at 80% 100%, var(--green-3), transparent 50%), var(--bg-page)",
        padding: "40px 20px",
      }}
    >
      <div
        className="w-full rounded-[16px] bg-[var(--bg-panel)] text-left"
        style={{
          maxWidth: 560,
          padding: "44px 44px 32px",
          boxShadow:
            "0 1px 0 var(--gray-a4), 0 30px 80px -20px rgba(0,0,0,0.18)",
        }}
      >
        <div
          className="grid h-12 w-12 place-items-center rounded-[12px] text-white"
          style={{
            background: "var(--purple-9)",
            font: "800 22px var(--font-sans)",
            marginBottom: 18,
          }}
        >
          D
        </div>
        <div
          id="splash-title"
          className="text-[28px] font-bold tracking-[-0.02em] text-[var(--fg-1)]"
        >
          Diff Dad
        </div>
        <p
          className="mb-6 mt-1.5 text-[15px] leading-[22px] text-[var(--fg-2)]"
          style={{ maxWidth: "42ch" }}
        >
          A per-PR review tool that opens the diff as a story.
        </p>

        <div
          className="mb-6 rounded-[10px] px-4 py-3.5"
          style={{
            background: "var(--gray-2)",
            boxShadow: "inset 0 0 0 1px var(--gray-a4)",
          }}
        >
          <div
            className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--fg-3)]"
          >
            Run from your terminal
          </div>
          <div
            className="flex items-center gap-2.5 rounded-[6px] px-3 py-2.5 text-[14px] font-medium"
            style={{
              background: "var(--gray-1)",
              boxShadow: "inset 0 0 0 1px var(--gray-a4)",
              fontFamily:
                '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
              color: "var(--fg-1)",
            }}
          >
            <span
              className="font-bold"
              style={{ color: "var(--purple-10)" }}
            >
              $
            </span>
            <code className="flex-1">
              dad review <span style={{ color: "var(--purple-11)" }}>&lt;pr-number&gt;</span>
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-[26px] items-center rounded-[5px] px-2 text-[11.5px] font-medium text-[var(--fg-2)] hover:bg-[var(--gray-3)] hover:text-[var(--fg-1)]"
              style={{ boxShadow: "inset 0 0 0 1px var(--gray-a5)" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-2 text-[12.5px] text-[var(--fg-3)]">
            e.g.{" "}
            <code
              className="rounded-[3px] px-[5px] py-px font-mono text-[12px] font-medium"
              style={{ background: "var(--gray-3)", color: "var(--fg-1)" }}
            >
              dad review 1847
            </code>{" "}
            opens this PR with a live event stream.
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-2">
          {STEPS.map((step) => (
            <div
              key={step.num}
              className="flex items-center gap-3 text-[13.5px] text-[var(--fg-2)]"
            >
              <span
                className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold"
                style={{ background: "var(--gray-3)", color: "var(--fg-2)" }}
              >
                {step.num}
              </span>
              <span>
                {step.text}
                {step.code ? (
                  <code
                    className="rounded-[3px] px-[5px] py-px font-mono text-[12.5px] font-medium"
                    style={{
                      background: "var(--gray-3)",
                      color: "var(--fg-1)",
                    }}
                  >
                    {step.code}
                  </code>
                ) : null}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-2 rounded-[6px] bg-[var(--brand)] px-[18px] py-[10px] text-[14px] font-bold text-white hover:bg-[var(--brand-hover)]"
          style={{ boxShadow: "0 1px 2px rgba(3,2,13,0.08)" }}
        >
          Continue with demo PR
          <IconArrowRight className="h-[13px] w-[13px]" />
        </button>

        <div className="mt-3.5 text-center text-[12px] text-[var(--fg-3)]">
          {copy.tagline}
        </div>
      </div>
    </div>
  );
}
