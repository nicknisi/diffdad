import { useReviewStore } from '../state/review-store';
import type { DiffFile } from '../state/types';

function changeTotals(files: DiffFile[]): { adds: number; removes: number } {
  let adds = 0;
  let removes = 0;
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type === 'add') adds++;
        else if (l.type === 'remove') removes++;
      }
    }
  }
  return { adds, removes };
}

function LoopStat({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[var(--fg-2)]"
      style={n === 0 ? { opacity: 0.45 } : undefined}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      <b className="font-semibold text-[var(--fg-1)]">{n}</b> {label}
    </span>
  );
}

/**
 * The watch-mode loop rail: how much changed, and where each agent comment sits in the
 * open -> delivered -> addressed lifecycle. This status is the "steering surface" — the
 * part that makes watch more than a diff view. Sticky directly under the AppBar.
 */
export function WatchStatusBar() {
  const files = useReviewStore((s) => s.files);
  const agentComments = useReviewStore((s) => s.agentComments);

  const open = agentComments.filter((c) => c.status === 'open').length;
  const delivered = agentComments.filter((c) => c.status === 'delivered').length;
  const addressed = agentComments.filter((c) => c.status === 'addressed').length;
  const { adds, removes } = changeTotals(files);
  const fileCount = files.length;

  return (
    <section
      className="sticky top-[52px] z-20 flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-[var(--bg-panel)] px-6 py-2.5"
      style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
    >
      <span className="text-[13px] text-[var(--fg-2)]">
        <b className="font-semibold text-[var(--fg-1)]">{fileCount}</b> {fileCount === 1 ? 'file' : 'files'} changed
        {fileCount > 0 && (
          <>
            {'  '}
            <span className="font-mono" style={{ color: 'var(--green-11)' }}>
              +{adds}
            </span>{' '}
            <span className="font-mono" style={{ color: 'var(--red-11)' }}>
              −{removes}
            </span>
          </>
        )}
      </span>
      <span className="ml-auto flex items-center gap-3.5 text-[12px]">
        <LoopStat color="var(--amber-9)" label="open" n={open} />
        <LoopStat color="var(--blue-11)" label="delivered" n={delivered} />
        <LoopStat color="var(--green-9)" label="addressed" n={addressed} />
      </span>
    </section>
  );
}
