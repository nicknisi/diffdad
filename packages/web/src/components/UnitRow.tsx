import { groupOf, relativeTime, type SourceBadge, sourceBadge, type VerdictTone, verdictTone } from '../lib/units-view';
import type { Unit, UnitStatus } from '../state/types';

/** Source-badge palette — github reads blue (comments post to the PR). */
const SOURCE_TONE: Record<SourceBadge['tone'], React.CSSProperties> = {
  github: { background: 'var(--blue-3)', color: 'var(--blue-11)' },
};

const TONE: Record<VerdictTone, { fg: string; glyph: string }> = {
  risk: { fg: 'var(--red-11)', glyph: '▲' },
  warn: { fg: 'var(--yellow-11)', glyph: '⚠' },
  safe: { fg: 'var(--green-11)', glyph: '✓' },
  neutral: { fg: 'var(--fg-3)', glyph: '•' },
};

/** In-flight / cleared rows lead with a status glyph rather than a verdict. */
const STATUS_META: Record<UnitStatus, { glyph: string; label: string; color: string }> = {
  queued: { glyph: '▸', label: 'needs you', color: 'var(--fg-2)' },
  changes_requested: { glyph: '↩', label: 'changes requested', color: 'var(--amber-11)' },
  approved: { glyph: '✓', label: 'approved', color: 'var(--green-11)' },
  done: { glyph: '✓', label: 'done', color: 'var(--green-11)' },
};

type Props = {
  unit: Unit;
  /** Ticking clock (ms) from the parent, so every row's elapsed label updates in lockstep. */
  now: number;
  onOpen: (unit: Unit) => void;
  /** Remove the unit from the queue (manual cleanup). Shown on every row when provided. */
  onRemove?: (unit: Unit) => void;
  /** A remove for this unit is in flight — disables its ✕ button. */
  busy?: boolean;
};

/**
 * One queue / in-flight / cleared row. The whole row is a single button (a generous click target
 * that opens the unit's review); verdicts are only ever submitted from the drill-in, never inline.
 */
export function UnitRow({ unit, now, onOpen, onRemove, busy }: Props) {
  const group = groupOf(unit.status);
  const isNeedsYou = group === 'needs-you';
  const tone = TONE[verdictTone(unit.verdict)];
  const status = STATUS_META[unit.status];
  const lead = isNeedsYou ? tone : { fg: status.color, glyph: status.glyph };
  const branch = unit.metadata?.branch;
  const elapsed = relativeTime(unit.updatedAt, now);
  const badge = sourceBadge(unit.source);

  const meta: string[] = [];
  if (isNeedsYou) meta.push(unit.toResolve === 1 ? '1 to resolve' : `${unit.toResolve} to resolve`);
  const fileCount = unit.metadata?.changedFiles ?? unit.files?.length;
  if (typeof fileCount === 'number') meta.push(fileCount === 1 ? '1 file' : `${fileCount} files`);
  if (!isNeedsYou) meta.unshift(status.label);
  if (elapsed) meta.push(elapsed);

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <button
        type="button"
        onClick={() => onOpen(unit)}
        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        aria-label={`Open ${unit.taskLabel}`}
      >
        <span className="mt-[2px] shrink-0 text-[13px] leading-none" style={{ color: lead.fg }} aria-hidden>
          {lead.glyph}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-[13.5px]">
            <span className="text-[var(--fg-3)]">{unit.repo}</span>
            {branch && (
              <>
                <span className="text-[var(--fg-3)]">·</span>
                <span className="font-mono text-[12.5px] text-[var(--fg-3)]">{branch}</span>
              </>
            )}
            <span className="text-[var(--fg-3)]">·</span>
            <span className="font-medium text-[var(--fg-1)]">{unit.taskLabel}</span>
            <span
              className="rounded px-1 py-px text-[10.5px] font-medium leading-none"
              style={SOURCE_TONE[badge.tone]}
              title={badge.title}
            >
              {badge.label}
            </span>
            {unit.prAuthor && (
              <span className="text-[12px] text-[var(--fg-3)]" title={`PR by @${unit.prAuthor}`}>
                @{unit.prAuthor}
              </span>
            )}
          </span>
          {meta.length > 0 && <span className="mt-0.5 block text-[12px] text-[var(--fg-3)]">{meta.join(' · ')}</span>}
        </span>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(unit)}
          disabled={busy}
          title="Remove from queue"
          aria-label="Remove from queue"
          className="shrink-0 rounded p-1 text-[13px] leading-none text-[var(--fg-3)] opacity-40 transition-opacity hover:text-[var(--red-11)] hover:opacity-100 disabled:opacity-20"
        >
          ✕
        </button>
      )}
    </div>
  );
}
