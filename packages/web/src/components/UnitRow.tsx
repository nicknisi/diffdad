import { useState } from 'react';
import {
  drawerNote,
  laneOf,
  reasonLine,
  relativeTime,
  type SourceBadge,
  sourceBadge,
  stakesOf,
} from '../lib/units-view';
import type { Lane, TriagedFile, Unit, UnitStatus } from '../state/types';

/** Source-badge palette — github reads blue (comments post to the PR), a hand-added PR reads neutral. */
const SOURCE_TONE: Record<SourceBadge['tone'], React.CSSProperties> = {
  github: { background: 'var(--blue-3)', color: 'var(--blue-11)' },
  added: { background: 'var(--gray-3)', color: 'var(--fg-2)' },
};

/**
 * The lead glyph. It stays, but it is no longer the signal: every unopened row used to render the same
 * grey bullet because `verdict` is only written during the on-open hydrate, so the column carried nothing.
 * The two attention lanes now get a mark that means something on its own; the other two keep the status
 * glyph, since status is genuinely what put them there.
 */
const LANE_LEAD: Record<Lane, { fg: string; glyph: string } | null> = {
  'needs-you': { fg: 'var(--red-11)', glyph: '▲' },
  'probably-not': { fg: 'var(--fg-3)', glyph: '○' },
  'in-flight': null,
  cleared: null,
};

/** In-flight / cleared rows lead with a status glyph rather than a lane mark. */
const STATUS_META: Record<UnitStatus, { glyph: string; label: string; color: string }> = {
  queued: { glyph: '▸', label: 'needs you', color: 'var(--fg-2)' },
  changes_requested: { glyph: '↩', label: 'changes requested', color: 'var(--amber-11)' },
  approved: { glyph: '✓', label: 'approved', color: 'var(--green-11)' },
  done: { glyph: '✓', label: 'done', color: 'var(--green-11)' },
};

/**
 * Stakes are typography and padding only — deliberately no color, no icon, no reflow. The point is that a
 * four-line typo fix and a nine-hundred-line auth refactor stop rendering identically; the moment it also
 * recolors rows it has become a visual redesign, which is the specific risk two plan critics flagged.
 */
const STAKES: Record<'high' | 'mid' | 'low', { pad: string; title: string }> = {
  high: { pad: 'py-3', title: 'text-[14.5px] font-semibold' },
  mid: { pad: 'py-2.5', title: 'text-[13.5px] font-medium' },
  low: { pad: 'py-2', title: 'text-[13px] font-medium' },
};

/** How many files the drawer lists before summarising the rest — a 100-file PR must not own the page. */
const FILE_CAP = 12;

type Props = {
  unit: Unit;
  /** Ticking clock (ms) from the parent, so every row's elapsed label updates in lockstep. */
  now: number;
  onOpen: (unit: Unit) => void;
  /** Hide the unit until its author pushes past the current head. Shown on every row when provided. */
  onRemove?: (unit: Unit) => void;
  /** A dismissal for this unit is in flight — disables its ✕ button. */
  busy?: boolean;
};

/**
 * The evidence drawer's file list. Exported so it can be rendered from a test on its own props: the web
 * suite has no DOM by default, so the drawer's open state is unreachable through `UnitRow` itself.
 */
export function FileTable({ files, truncated }: { files: TriagedFile[]; truncated: boolean }) {
  const shown = files.slice(0, FILE_CAP);
  const rest = files.length - shown.length;
  return (
    <>
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {shown.map((f) => (
            <tr key={f.path}>
              <td className="py-[3px] pr-3 font-mono text-[11.5px] text-[var(--fg-2)]">{f.path}</td>
              <td className="w-px whitespace-nowrap py-[3px] text-right">
                <span
                  className="rounded px-1 py-px text-[10.5px] leading-none"
                  style={
                    f.criticality.length > 0
                      ? { background: 'var(--red-3)', color: 'var(--red-11)' }
                      : f.kind === 'source'
                        ? { background: 'var(--amber-3)', color: 'var(--amber-11)' }
                        : { background: 'var(--gray-3)', color: 'var(--fg-2)' }
                  }
                >
                  {f.criticality.length > 0 ? `${f.kind} · criticality` : f.kind}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rest > 0 && (
        // The count is over what was actually fetched. On a truncated PR the true total is unknown, so
        // the copy says which number this is rather than implying it is the whole diff.
        <p className="mt-1.5 text-[11.5px] text-[var(--fg-3)]">
          …and {rest} more{truncated ? ' of the first 100 fetched' : ''}
        </p>
      )}
    </>
  );
}

/**
 * One queue row. The whole title block is a single button (a generous click target that opens the unit's
 * review); verdicts are only ever submitted from the drill-in, never inline.
 *
 * The row leads with the evidence reason rather than a verdict glyph, and it no longer prints
 * `${toResolve} to resolve` — that field is initialised to 0 and only written during the on-open hydrate,
 * so for every row in the queue it rendered a placeholder as if it were a measurement.
 */
export function UnitRow({ unit, now, onOpen, onRemove, busy }: Props) {
  const [open, setOpen] = useState(false);
  const lane = laneOf(unit);
  const status = STATUS_META[unit.status];
  const lead = LANE_LEAD[lane] ?? { fg: status.color, glyph: status.glyph };
  const stakes = STAKES[stakesOf(unit)];
  const branch = unit.metadata?.branch;
  const elapsed = relativeTime(unit.updatedAt, now);
  const badge = sourceBadge(unit);
  const triage = unit.triage;
  const tags = triage?.criticality ?? [];

  const meta: string[] = [];
  if (lane === 'in-flight' || lane === 'cleared') meta.push(status.label);
  // Search-minted units carry changedFiles:0 until hydrated, so `??` would assert "0 files". Prefer the
  // triaged file list, then a truthy PR count, then a hydrated diff — and otherwise omit. An unknown
  // beats a lie.
  const fileCount = triage?.files.length || unit.metadata?.changedFiles || unit.files?.length;
  // A truncated PR's `files` holds only the page that was fetched, so the raw count would understate it —
  // and this is also where truncation stays visible on a row whose chip went to criticality instead (see
  // the tag branch below).
  if (triage?.truncated) meta.push('over 100 files');
  else if (fileCount) meta.push(fileCount === 1 ? '1 file' : `${fileCount} files`);
  if (triage && triage.additions + triage.deletions > 0) meta.push(`+${triage.additions}/−${triage.deletions}`);
  // Only what the rollup actually supports. It carries counts, not the requested-reviewer total, so
  // "1 of 3 reviewers" is not derivable and is not claimed.
  if (unit.reviewRollup) {
    const { approved } = unit.reviewRollup;
    meta.push(
      approved === 0 ? 'nobody has approved' : approved === 1 ? '1 approval already' : `${approved} approvals already`,
    );
  }
  if (elapsed) meta.push(elapsed);

  const reason = reasonLine(unit);

  return (
    <div>
      <div className={`flex items-center gap-3 px-3.5 ${stakes.pad}`}>
        <button
          type="button"
          onClick={() => onOpen(unit)}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          aria-label={`Open ${unit.taskLabel}`}
        >
          <span className="mt-[3px] shrink-0 text-[13px] leading-none" style={{ color: lead.fg }} aria-hidden>
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
              <span className={`text-[var(--fg-1)] ${stakes.title}`}>{unit.taskLabel}</span>
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
            {/* The reason leads the meta line. Criticality renders as its own tags, read straight off the
                triage rather than re-split out of the string.
                One deliberate divergence from `reasonLine`: it ranks truncation above criticality, mirroring
                the CLI's *veto* order, but a veto order is about what disqualifies a PR from the quiet lane,
                not about which fact a reader most needs. On a PR that is both, the tags win the chip — and
                truncation is not lost, because the meta line above states it unconditionally. */}
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
              {tags.length > 0 ? (
                tags.map((t) => (
                  <span
                    key={t}
                    className="rounded px-1 py-px text-[10.5px] font-medium leading-none"
                    style={{ background: 'var(--red-3)', color: 'var(--red-11)' }}
                  >
                    {t}
                  </span>
                ))
              ) : (
                <span
                  className="rounded px-1 py-px text-[10.5px] font-medium leading-none"
                  style={{ background: 'var(--gray-3)', color: 'var(--fg-2)' }}
                >
                  {reason}
                </span>
              )}
              {meta.length > 0 && <span className="text-[var(--fg-3)]">{meta.join(' · ')}</span>}
            </span>
          </span>
        </button>

        {/* Every lane, not just the two attention ones: "why is this row here?" is a fair question of an
            in-flight row too, and `drawerNote` answers it honestly ("status decides this one, not its files").
            The mockup renders the card on its in-flight row for the same reason. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Why it landed here"
          aria-label="Why it landed here"
          aria-expanded={open}
          className="shrink-0 rounded p-1 text-[13px] leading-none text-[var(--fg-3)] transition-transform hover:text-[var(--fg-1)]"
          style={open ? { transform: 'rotate(90deg)' } : undefined}
        >
          ›
        </button>

        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(unit)}
            disabled={busy}
            title="Dismiss until they push"
            aria-label="Dismiss until they push"
            className="shrink-0 rounded p-1 text-[13px] leading-none text-[var(--fg-3)] opacity-40 transition-opacity hover:text-[var(--red-11)] hover:opacity-100 disabled:opacity-20"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="px-3.5 pb-3">
          <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-page)' }}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--fg-3)]">
              Why it landed here — every file, classified
            </p>
            {triage && triage.files.length > 0 ? (
              <FileTable files={triage.files} truncated={triage.truncated} />
            ) : (
              <p className="text-[12px] text-[var(--fg-3)]">No file list was gathered.</p>
            )}
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--fg-2)]">{drawerNote(unit)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
