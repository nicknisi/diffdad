import { useReviewStore } from "../state/review-store";
import type { DiffFile } from "../state/types";
import { Hunk } from "./Hunk";

function fileStats(file: DiffFile): { adds: number; removes: number } {
  let adds = 0;
  let removes = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") adds++;
      else if (line.type === "remove") removes++;
    }
  }
  return { adds, removes };
}

export function ClassicView() {
  const files = useReviewStore((s) => s.files);

  if (!files.length) return null;

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6">
      <div className="flex flex-col gap-5">
        {files.map((file) => {
          const { adds, removes } = fileStats(file);
          return (
            <article
              key={file.file}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            >
              <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                <span className="font-mono text-sm font-bold text-gray-800 dark:text-gray-100">
                  {file.file}
                </span>
                {file.isNewFile ? (
                  <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                    new file
                  </span>
                ) : null}
                {file.isDeleted ? (
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                    deleted
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-xs">
                  <span className="font-medium text-green-700 dark:text-green-400">
                    +{adds}
                  </span>{" "}
                  <span className="font-medium text-red-700 dark:text-red-400">
                    −{removes}
                  </span>
                </span>
              </header>
              <div className="px-3 pb-3">
                {file.hunks.map((hunk, idx) => (
                  <Hunk
                    key={`${file.file}-${idx}`}
                    file={file.file}
                    hunk={hunk}
                    isNewFile={file.isNewFile}
                    hunkIndex={idx}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
