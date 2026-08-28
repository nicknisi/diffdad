import type { CallStackFrame } from '../state/types';

type Props = {
  title: string;
  frames: CallStackFrame[];
  /**
   * Resolve a frame's `file`+`hunkIndex` to the DOM id of the hunk rendered in THIS chapter, or null
   * when that hunk is not shown here. When null, the frame renders its file as a non-interactive dim
   * suffix instead of a scroll link.
   */
  resolveHunkId?: (file: string, hunkIndex: number) => string | null;
};

type ChangeKind = CallStackFrame['change'];

// Marker + colors per change kind. Row tints mirror Hunk/CodeLine's add/remove rgba tints so the tree
// reads like the diff it summarizes; modified uses amber, unchanged is dim with no tint.
const CHANGE_STYLES: Record<ChangeKind, { marker: string; color: string; rowBg: string }> = {
  added: { marker: '+', color: 'var(--green-11)', rowBg: 'rgba(41, 163, 131, 0.08)' },
  removed: { marker: '-', color: 'var(--red-11)', rowBg: 'rgba(229, 70, 102, 0.08)' },
  modified: { marker: '~', color: 'var(--amber-11)', rowBg: 'rgba(232, 179, 57, 0.12)' },
  unchanged: { marker: ' ', color: 'var(--fg-3)', rowBg: 'transparent' },
};

/** True when no later frame is a sibling of `frames[i]` (same depth before the depth drops below it). */
function isLastSibling(frames: CallStackFrame[], i: number): boolean {
  const d = frames[i]!.depth;
  for (let j = i + 1; j < frames.length; j++) {
    const dj = frames[j]!.depth;
    if (dj < d) return true;
    if (dj === d) return false;
  }
  return true;
}

export type TreeRow = { frame: CallStackFrame; prefix: string; index: number };

/**
 * Build the tree connector prefix for each frame: vertical guides (│) for ancestor levels that still
 * have siblings below, and a ├─/└─ elbow at the frame's own depth. Pure and exported for testing.
 */
export function buildTreeRows(frames: CallStackFrame[]): TreeRow[] {
  const lastAtDepth: boolean[] = [];
  return frames.map((frame, i) => {
    const d = Math.max(0, frame.depth);
    const last = isLastSibling(frames, i);
    lastAtDepth[d] = last;
    let prefix = '';
    for (let level = 1; level < d; level++) {
      prefix += lastAtDepth[level] ? '   ' : '\u2502  ';
    }
    if (d > 0) prefix += last ? '\u2514\u2500 ' : '\u251c\u2500 ';
    return { frame, prefix, index: i };
  });
}

function scrollToHunk(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function CallStackSection({ title, frames, resolveHunkId }: Props) {
  const rows = buildTreeRows(frames);

  return (
    <div
      className="ml-[34px] mb-[14px] overflow-hidden rounded-[8px] bg-[var(--bg-panel)]"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      <div
        className="flex items-center gap-2 bg-[var(--gray-2)] px-3 py-2 font-mono text-[12.5px] text-[var(--fg-2)]"
        style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        <span aria-hidden className="text-[var(--fg-3)]">
          ⌇
        </span>
        <span className="font-semibold text-[var(--fg-1)]">{title || 'Call flow'}</span>
        <span className="text-[var(--fg-3)]">call-stack diff</span>
      </div>
      <div className="overflow-x-auto py-1" style={{ minWidth: 'max-content' }}>
        {rows.map(({ frame, prefix, index }) => {
          const style = CHANGE_STYLES[frame.change];
          const targetId =
            frame.file != null && frame.hunkIndex != null
              ? (resolveHunkId?.(frame.file, frame.hunkIndex) ?? null)
              : null;
          return (
            <div
              key={index}
              className="grid items-center font-mono text-[12.75px] leading-[20px]"
              style={{ gridTemplateColumns: '16px 1fr', background: style.rowBg }}
            >
              <span className="select-none text-center font-bold" style={{ color: style.color }}>
                {style.marker}
              </span>
              <span className="whitespace-pre pr-3" style={{ color: 'var(--gray-12)' }}>
                <span className="select-none text-[var(--fg-3)]">{prefix}</span>
                {targetId ? (
                  <button
                    type="button"
                    onClick={() => scrollToHunk(targetId)}
                    className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-[var(--brand)]"
                    style={{ color: 'inherit', background: 'transparent' }}
                  >
                    {frame.label}
                  </button>
                ) : (
                  <span>{frame.label}</span>
                )}
                {!targetId && frame.file ? (
                  <span className="ml-2 text-[11.5px] text-[var(--fg-3)]">{frame.file}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
