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
    <div className="mx-auto max-w-[1100px] px-6 pb-20 pt-[18px]">
      <div className="flex flex-col gap-3.5">
        {files.map((file) => {
          const { adds, removes } = fileStats(file);
          return (
            <article
              key={file.file}
              className="overflow-hidden rounded-[8px] bg-[var(--bg-panel)]"
              style={{ boxShadow: "inset 0 0 0 1px var(--gray-a5)" }}
            >
              <header
                className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5"
                style={{
                  background: "var(--gray-2)",
                  boxShadow: "inset 0 -1px 0 var(--gray-a4)",
                }}
              >
                <span className="font-mono text-[13px] font-semibold text-[var(--fg-1)]">
                  {file.file}
                </span>
                {file.isNewFile ? (
                  <span
                    className="rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em]"
                    style={{
                      background: "var(--green-3)",
                      color: "var(--green-11)",
                    }}
                  >
                    new file
                  </span>
                ) : null}
                {file.isDeleted ? (
                  <span
                    className="rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em] text-white"
                    style={{ background: "var(--red-9)" }}
                  >
                    deleted
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[12px] font-medium">
                  <span style={{ color: "var(--green-11)" }}>+{adds}</span>{" "}
                  <span style={{ color: "var(--red-11)" }}>−{removes}</span>
                </span>
              </header>
              <div className="px-0 pb-0">
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
