import { useReviewStore } from "../state/review-store";

export function PRHeader() {
  const pr = useReviewStore((s) => s.pr);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  if (!pr) return null;

  const prUrl = repoUrl ? `${repoUrl}/pull/${pr.number}` : null;

  return (
    <section className="border-b border-gray-200 bg-white px-8 py-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[22px] font-bold tracking-[-0.0125em] leading-[27px] text-gray-900 dark:text-gray-50">
          <span className="font-normal text-gray-400 dark:text-gray-500">
            #{pr.number}
          </span>{" "}
          {pr.title}
        </h1>
        {prUrl ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            View on GitHub
          </a>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-gray-600 dark:text-gray-400">
        <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[12.5px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
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
