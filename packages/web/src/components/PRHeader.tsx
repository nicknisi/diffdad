import { useMemo, useState } from "react";
import { useReviewStore } from "../state/review-store";
import type { CheckRun } from "../state/types";
import { SubmitDialog } from "./SubmitDialog";
import { Toast } from "./Toast";

type CheckSummary = {
  passing: number;
  failing: number;
  pending: number;
  neutral: number;
  total: number;
};

function summarizeChecks(checks: CheckRun[]): CheckSummary {
  let passing = 0;
  let failing = 0;
  let pending = 0;
  let neutral = 0;
  for (const c of checks) {
    if (c.status !== "completed") {
      pending++;
      continue;
    }
    switch (c.conclusion) {
      case "success":
        passing++;
        break;
      case "failure":
      case "timed_out":
      case "action_required":
      case "cancelled":
        failing++;
        break;
      case "neutral":
      case "skipped":
        neutral++;
        break;
      default:
        pending++;
    }
  }
  return { passing, failing, pending, neutral, total: checks.length };
}

function checkIcon(c: CheckRun): { icon: string; color: string; label: string } {
  if (c.status !== "completed") {
    return {
      icon: "◯",
      color: "text-amber-600 dark:text-amber-400",
      label: c.status,
    };
  }
  switch (c.conclusion) {
    case "success":
      return {
        icon: "✓",
        color: "text-green-700 dark:text-green-400",
        label: "success",
      };
    case "failure":
    case "timed_out":
    case "action_required":
    case "cancelled":
      return {
        icon: "✗",
        color: "text-red-700 dark:text-red-400",
        label: c.conclusion ?? "failure",
      };
    case "neutral":
    case "skipped":
      return {
        icon: "⋯",
        color: "text-gray-500 dark:text-gray-400",
        label: c.conclusion ?? "neutral",
      };
    default:
      return {
        icon: "◯",
        color: "text-amber-600 dark:text-amber-400",
        label: c.conclusion ?? "pending",
      };
  }
}

function timeAgo(iso: string | undefined | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function PRHeader() {
  const pr = useReviewStore((s) => s.pr);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const checkRuns = useReviewStore((s) => s.checkRuns);
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);
  const clearDrafts = useReviewStore((s) => s.clearDrafts);
  const [open, setOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const summary = useMemo(() => summarizeChecks(checkRuns), [checkRuns]);

  if (!pr) return null;

  const prUrl = repoUrl ? `${repoUrl}/pull/${pr.number}` : null;

  const baseBtn =
    "px-3 py-1 text-sm font-medium rounded-md transition-colors";
  const activeBtn =
    "bg-white text-gray-900 border border-gray-200 shadow-sm dark:bg-gray-900 dark:text-gray-50 dark:border-gray-700";
  const inactiveBtn =
    "bg-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";

  let checksLabel: { text: string; className: string } | null = null;
  if (summary.total > 0) {
    if (summary.failing > 0) {
      checksLabel = {
        text: `✗ ${summary.failing} failing`,
        className:
          "text-red-700 dark:text-red-400 border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50",
      };
    } else if (summary.pending > 0) {
      checksLabel = {
        text: `◯ ${summary.pending} pending`,
        className:
          "text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50",
      };
    } else {
      checksLabel = {
        text: `✓ ${summary.passing} checks passing`,
        className:
          "text-green-700 dark:text-green-400 border-green-300 dark:border-green-800/60 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50",
      };
    }
  }

  function handleSubmit() {
    setSubmitOpen(false);
    clearDrafts();
    setToast("✓ Review submitted to GitHub");
  }

  const authorUrl = pr.author?.login
    ? `https://github.com/${pr.author.login}`
    : null;

  return (
    <section className="border-b border-gray-200 bg-white px-8 py-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-[-0.0125em] text-gray-900 dark:text-gray-50">
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-normal text-gray-400 hover:text-brand dark:text-gray-500"
            >
              #{pr.number}
            </a>
          ) : (
            <span className="font-normal text-gray-400 dark:text-gray-500">
              #{pr.number}
            </span>
          )}{" "}
          {pr.title}
        </h1>
        <div className="flex shrink-0 items-center gap-3">
          <div
            role="tablist"
            aria-label="View mode"
            className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "story"}
              onClick={() => setView("story")}
              className={`${baseBtn} ${view === "story" ? activeBtn : inactiveBtn}`}
            >
              Story
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "files"}
              onClick={() => setView("files")}
              className={`${baseBtn} ${view === "files" ? activeBtn : inactiveBtn}`}
            >
              Files
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
          >
            Submit review
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
        <span className="rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-[12px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {pr.branch} <span className="text-gray-400 dark:text-gray-500">→</span>{" "}
          {pr.base}
        </span>
        {authorUrl ? (
          <a
            href={authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-gray-900 hover:text-brand dark:text-gray-100"
          >
            {pr.author.login}
          </a>
        ) : (
          <span className="font-bold text-gray-900 dark:text-gray-100">
            {pr.author?.login ?? "unknown"}
          </span>
        )}
        <span className="text-gray-500 dark:text-gray-400">
          opened {timeAgo(pr.createdAt)} · updated {timeAgo(pr.updatedAt)}
        </span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span>
          <span className="font-medium text-green-700 dark:text-green-400">
            +{pr.additions}
          </span>{" "}
          <span className="font-medium text-red-700 dark:text-red-400">
            −{pr.deletions}
          </span>{" "}
          across {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </span>
        {checksLabel ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm font-medium transition-colors ${checksLabel.className}`}
            >
              <span>{checksLabel.text}</span>
              <span className="text-xs opacity-70">{open ? "▲" : "▼"}</span>
            </button>
            {open ? (
              <div className="absolute left-0 top-full z-20 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <div className="max-h-96 overflow-y-auto">
                  {checkRuns.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      No checks reported.
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {checkRuns.map((cr) => {
                        const ico = checkIcon(cr);
                        const failed =
                          cr.status === "completed" &&
                          (cr.conclusion === "failure" ||
                            cr.conclusion === "timed_out" ||
                            cr.conclusion === "action_required" ||
                            cr.conclusion === "cancelled");
                        return (
                          <li
                            key={cr.id}
                            className="flex flex-col gap-1 px-3 py-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`shrink-0 font-bold ${ico.color}`}
                                aria-label={ico.label}
                              >
                                {ico.icon}
                              </span>
                              <span className="flex-1 truncate font-medium text-gray-800 dark:text-gray-100">
                                {cr.name}
                              </span>
                              {cr.detailsUrl ? (
                                <a
                                  href={cr.detailsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  View
                                </a>
                              ) : null}
                            </div>
                            {failed && cr.output?.title ? (
                              <div className="pl-6 text-xs text-red-700 dark:text-red-400">
                                {cr.output.title}
                                {cr.output.summary ? (
                                  <div className="mt-0.5 whitespace-pre-wrap text-red-600/80 dark:text-red-400/80">
                                    {cr.output.summary.slice(0, 240)}
                                    {cr.output.summary.length > 240 ? "…" : ""}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmit={handleSubmit}
      />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </section>
  );
}
