import { useEffect, useState } from 'react';
import { clampStep, currentMessage, nextStep, prevStep, type TourState } from '../lib/sequence-tour';
import type { SequenceMessage } from '../state/types';

type Props = {
  title: string;
  participants: string[];
  messages: SequenceMessage[];
  /**
   * Resolve a message's `file`+`hunkIndex` to the DOM id of the hunk rendered in THIS chapter, or null
   * when that hunk is not shown here. Identical contract to CallStackSection: only hunks actually shown
   * in the chapter are scroll targets. Used by the tour to scroll the active step's hunk into view.
   */
  resolveHunkId?: (file: string, hunkIndex: number) => string | null;
};

// Fixed geometry so the diagram is deterministic and hand-laid (no layout library).
const LANE_WIDTH = 160;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 48;
const TOP_PAD = 18;
const BOTTOM_PAD = 16;
const SELF_LOOP_WIDTH = 46;

function scrollToHunk(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Center x of a participant column, or null when the name is not a known participant. */
function laneX(participants: string[], name: string): number | null {
  const i = participants.indexOf(name);
  if (i < 0) return null;
  return i * LANE_WIDTH + LANE_WIDTH / 2;
}

export function SequenceSection({ title, participants, messages, resolveHunkId }: Props) {
  const [walking, setWalking] = useState(false);
  const [tour, setTour] = useState<TourState>({ index: 0 });

  const count = messages.length;
  const activeIndex = walking ? clampStep(tour.index, count) : -1;
  const active = walking ? currentMessage(messages, tour) : null;

  // Scroll the active step's linked hunk into view, matching CallStackSection's mechanism.
  useEffect(() => {
    if (!walking || !active || active.file == null || active.hunkIndex == null) return;
    const id = resolveHunkId?.(active.file, active.hunkIndex) ?? null;
    if (id) scrollToHunk(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, activeIndex]);

  // Arrow keys step; Esc closes. Only while walking, so the diagram is inert until the tour starts.
  useEffect(() => {
    if (!walking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setTour((s) => nextStep(s, count));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setTour((s) => prevStep(s, count));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setWalking(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walking, count]);

  const width = Math.max(participants.length * LANE_WIDTH, LANE_WIDTH);
  const height = HEADER_HEIGHT + TOP_PAD + count * ROW_HEIGHT + BOTTOM_PAD;
  const lifelineBottom = height - BOTTOM_PAD / 2;

  const startWalk = () => {
    setTour({ index: 0 });
    setWalking(true);
  };

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
          ⇄
        </span>
        <span className="font-semibold text-[var(--fg-1)]">{title || 'Interaction'}</span>
        <span className="text-[var(--fg-3)]">sequence</span>
        {count > 0 ? (
          <button
            type="button"
            onClick={() => (walking ? setWalking(false) : startWalk())}
            className="ml-auto cursor-pointer rounded-[5px] px-2 py-1 text-[11.5px] font-medium"
            style={{ color: 'var(--purple-11)', boxShadow: 'inset 0 0 0 1px var(--purple-a5)' }}
          >
            {walking ? 'Done' : 'Walk through'}
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto py-1">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title || 'sequence diagram'}
          style={{ display: 'block' }}
        >
          <defs>
            <marker id="seq-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--fg-2)" />
            </marker>
            <marker id="seq-arrow-active" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--brand)" />
            </marker>
          </defs>

          {/* Participant boxes + lifelines */}
          {participants.map((p, j) => {
            const cx = j * LANE_WIDTH + LANE_WIDTH / 2;
            return (
              <g key={`p-${j}`}>
                <rect
                  x={cx - LANE_WIDTH / 2 + 10}
                  y={8}
                  width={LANE_WIDTH - 20}
                  height={HEADER_HEIGHT - 16}
                  rx={6}
                  fill="var(--gray-3)"
                  stroke="var(--gray-a5)"
                />
                <text
                  x={cx}
                  y={HEADER_HEIGHT / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily="monospace"
                  fontSize="12"
                  fontWeight="600"
                  fill="var(--fg-1)"
                >
                  {p}
                </text>
                <line
                  x1={cx}
                  y1={HEADER_HEIGHT}
                  x2={cx}
                  y2={lifelineBottom}
                  stroke="var(--gray-a5)"
                  strokeDasharray="4 4"
                />
              </g>
            );
          })}

          {/* Message arrows, top-down in array order */}
          {messages.map((m, i) => {
            const y = HEADER_HEIGHT + TOP_PAD + i * ROW_HEIGHT + ROW_HEIGHT / 2;
            const fromX = laneX(participants, m.from);
            const toX = laneX(participants, m.to);
            if (fromX == null || toX == null) return null;
            const isActive = i === activeIndex;
            const dim = walking && !isActive;
            const stroke = isActive ? 'var(--brand)' : 'var(--fg-2)';
            const marker = isActive ? 'url(#seq-arrow-active)' : 'url(#seq-arrow)';
            const labelFill = isActive ? 'var(--fg-1)' : 'var(--fg-2)';
            const selfMessage = m.from === m.to;

            return (
              <g key={`m-${i}`} opacity={dim ? 0.32 : 1} data-message-index={i}>
                {selfMessage ? (
                  <>
                    <path
                      d={`M${fromX},${y - 7} h${SELF_LOOP_WIDTH} v14 h${-SELF_LOOP_WIDTH}`}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isActive ? 2 : 1.25}
                      markerEnd={marker}
                    />
                    <text
                      x={fromX + SELF_LOOP_WIDTH + 6}
                      y={y}
                      dominantBaseline="middle"
                      fontFamily="monospace"
                      fontSize="11.5"
                      fill={labelFill}
                    >
                      {m.label}
                    </text>
                  </>
                ) : (
                  <>
                    <text
                      x={(fromX + toX) / 2}
                      y={y - 8}
                      textAnchor="middle"
                      fontFamily="monospace"
                      fontSize="11.5"
                      fill={labelFill}
                    >
                      {m.label}
                    </text>
                    <line
                      x1={fromX}
                      y1={y}
                      x2={toX + (toX > fromX ? -7 : 7)}
                      y2={y}
                      stroke={stroke}
                      strokeWidth={isActive ? 2 : 1.25}
                      markerEnd={marker}
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {walking && active ? (
        <div
          className="flex items-start gap-3 border-t px-3.5 py-3 text-[13px]"
          style={{ borderColor: 'var(--gray-a4)', background: 'var(--gray-2)' }}
          data-sequence-tour
        >
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTour((s) => prevStep(s, count))}
              className="cursor-pointer rounded-[5px] px-2 py-1 text-[12px] font-medium text-[var(--fg-2)]"
              style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setTour((s) => nextStep(s, count))}
              className="cursor-pointer rounded-[5px] px-2 py-1 text-[12px] font-medium text-[var(--fg-2)]"
              style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
            >
              Next
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">
              Step {activeIndex + 1} of {count}
            </div>
            <div className="mt-0.5 font-mono text-[12.5px] text-[var(--fg-1)]">{active.label}</div>
            {active.note ? <div className="mt-0.5 text-[12.5px] text-[var(--fg-2)]">{active.note}</div> : null}
          </div>
          <button
            type="button"
            onClick={() => setWalking(false)}
            className="flex-shrink-0 cursor-pointer rounded-[5px] px-2 py-1 text-[12px] font-medium"
            style={{ color: 'var(--purple-11)', boxShadow: 'inset 0 0 0 1px var(--purple-a5)' }}
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}
