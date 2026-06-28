import {
  groupOf,
  recommendedAction,
  relativeTime,
  type SourceBadge,
  sourceBadge,
  type VerdictTone,
  verdictTone,
} from '../lib/units-view';
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
  onApprove?: (unit: Unit) => void;
  onRequestChanges?: (unit: Unit) => void;
  /** Remove the unit from the queue (manual cleanup). Shown on every row when provided. */
  onRemove?: (unit: Unit) => void;
  /** A decision for this unit is in flight — disables its buttons. */
  busy?: boolean;
};

function PillButton({
  label,
  onClick,
  tone,
  disabled,
}: {
  label: string;
  onClick: () => void;
  tone: 'approve' | 'neutral' | 'warn';
  disabled?: boolean;
}) {
  const styles: Record<typeof tone, React.CSSProperties> = {
    approve: { background: 'var(--green-9)', color: 'white' },
    warn: { background: 'var(--amber-3)', color: 'var(--amber-11)', boxShadow: 'inset 0 0 0 1px var(--amber-a5)' },
    neutral: { background: 'var(--gray-3)', color: 'var(--fg-1)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-opacity disabled:opacity-50"
      style={styles[tone]}
    >
      {label}
    </button>
  );
}

/**
 * One queue / in-flight / cleared row. The left region is a single button (a generous click
 * target that opens the unit's review) so we never nest the decision buttons inside it. Needs-you
 * rows carry the recommended action + Approve / Request-changes; other groups are read-only digest.
 */
export function UnitRow({ unit, now, onOpen, onApprove, onRequestChanges, onRemove, busy }: Props) {
  const group = groupOf(unit.status);
  const isNeedsYou = group === 'needs-you';
  const tone = TONE[verdictTone(unit.verdict)];
  const status = STATUS_META[unit.status];
  const lead = isNeedsYou ? tone : { fg: status.color, glyph: status.glyph };
  const branch = unit.metadata?.branch;
  const elapsed = relativeTime(unit.updatedAt, now);
  const action = isNeedsYou ? recommendedAction(unit) : null;
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

      {isNeedsYou && (
        <div className="flex shrink-0 items-center gap-1.5">
          {action?.primary === 'approve' ? (
            <span className="mr-0.5 hidden text-[12px] font-medium text-[var(--green-11)] sm:inline">
              {action.label}
            </span>
          ) : (
            <span className="mr-0.5 hidden text-[12px] font-medium sm:inline" style={{ color: tone.fg }}>
              {action?.label}
            </span>
          )}
          {onApprove && <PillButton label="Approve" tone="approve" disabled={busy} onClick={() => onApprove(unit)} />}
          {onRequestChanges && (
            <PillButton label="Request changes" tone="warn" disabled={busy} onClick={() => onRequestChanges(unit)} />
          )}
        </div>
      )}

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
