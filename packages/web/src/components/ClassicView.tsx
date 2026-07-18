import { useReviewStore } from '../state/review-store';
import { fileStats } from '../lib/file-tree';
import type { DiffFile } from '../state/types';
import { FileTree, fileAnchorId } from './FileTree';
import { Hunk } from './Hunk';

function editedAgo(mtime?: number): string | null {
  if (!mtime) return null;
  const sec = Math.max(0, Math.floor((Date.now() - mtime) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function ClassicView() {
  const files = useReviewStore((s) => s.files);

  if (!files.length) return null;

  // A tree for a couple of files is chrome, not navigation — same reasoning as the story's
  // solo-chapter path. Enough files to actually scroll earns the sidebar.
  const showTree = files.length >= 4;

  const list = (
    <div className="flex min-w-0 flex-col gap-3.5">
      {files.map((file) => {
        const { adds, removes } = fileStats(file);
        const ago = editedAgo(file.mtime);
        return (
          <article
            key={file.file}
            id={fileAnchorId(file.file)}
            data-filepath={file.file}
            className="scroll-mt-[168px] overflow-hidden rounded-[8px] bg-[var(--bg-panel)]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
          >
            <header
              className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5"
              style={{
                background: 'var(--gray-2)',
                boxShadow: 'inset 0 -1px 0 var(--gray-a4)',
              }}
            >
              <span className="font-mono text-[13px] font-semibold text-[var(--fg-1)]">{file.file}</span>
              {file.isNewFile ? (
                <span
                  className="rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em]"
                  style={{
                    background: 'var(--green-3)',
                    color: 'var(--green-11)',
                  }}
                >
                  new file
                </span>
              ) : null}
              {file.isDeleted ? (
                <span
                  className="rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em] text-white"
                  style={{ background: 'var(--red-9)' }}
                >
                  deleted
                </span>
              ) : null}
              {ago ? (
                <span className="font-sans text-[11px] text-[var(--fg-3)]" title="working-tree modified time">
                  edited {ago}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-[12px] font-medium">
                <span style={{ color: 'var(--green-11)' }}>+{adds}</span>{' '}
                <span style={{ color: 'var(--red-11)' }}>−{removes}</span>
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
  );

  if (!showTree) {
    return <div className="mx-auto max-w-[1100px] px-6 pb-20 pt-[18px]">{list}</div>;
  }

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-[230px_minmax(0,1fr)] gap-6 px-6 pb-20 pt-[18px]">
      <FileTree files={files} />
      {list}
    </div>
  );
}
