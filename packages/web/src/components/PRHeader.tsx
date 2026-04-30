import { useReviewStore } from "../state/review-store";

export function PRHeader() {
  const pr = useReviewStore((s) => s.pr);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);
  if (!pr) return null;

  const prUrl = repoUrl ? `${repoUrl}/pull/${pr.number}` : null;

  const baseBtn =
    "px-3 py-1 text-sm font-medium rounded-md transition-colors";
  const activeBtn =
    "bg-white text-gray-900 border border-gray-200 shadow-sm dark:bg-gray-900 dark:text-gray-50 dark:border-gray-700";
  const inactiveBtn =
    "bg-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";

  return (
    <section className="border-b border-gray-200 bg-white px-8 py-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-[-0.0125em] text-gray-900 dark:text-gray-50">
          <span className="font-normal text-gray-400 dark:text-gray-500">
            #{pr.number}
          </span>{" "}
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
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              View on GitHub
            </a>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {pr.branch} → {pr.base}
        </span>
        <span>
          {pr.author?.login ?? "unknown"}
        </span>
        <span>
          <span className="font-medium text-green-700 dark:text-green-400">
            +{pr.additions}
          </span>{" "}
          <span className="font-medium text-red-700 dark:text-red-400">
            −{pr.deletions}
          </span>{" "}
          across {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </span>
      </div>
    </section>
  );
}
