import { useEffect, useRef, useState } from 'react';
import { getAccentMeta } from '../lib/accents';
import { useReviewStore } from '../state/review-store';
import { postDecision, removeUnit, retryUnit } from '../hooks/useUnits';
import { AccentPicker } from './AccentPicker';
import { ClassicView } from './ClassicView';
import { DadMark } from './DadMark';
import { ReviewProgress } from './ReviewProgress';
import { StoryView } from './StoryView';
import { ThemeToggle } from './ThemeToggle';
import type { ChapterState, Unit } from '../state/types';

/**
 * Feed a unit's diff slice + brief into the review store so the existing review surface
 * (StoryView / ClassicView, both store-driven) renders it. We set state directly rather than
 * via `setData` so the per-unit reviewed/draft localStorage (keyed by `pr.number`, which is the
 * 0 sentinel for every local unit) can't bleed across units — each open starts fresh.
 */
function applyUnitToStore(unit: Unit): void {
  const narrative = unit.narrative ?? null;
  const chapterStates: Record<string, ChapterState> = {};
  if (narrative) narrative.chapters.forEach((_, i) => (chapterStates[`ch-${i}`] = 'reading'));
  useReviewStore.setState({
    pr: unit.metadata ?? null,
    files: unit.files ?? [],
    narrative,
    comments: [],
    chapterStates,
    activeChapterId: narrative && narrative.chapters.length > 0 ? 'ch-0' : null,
    drafts: [],
  });
}

function BackLink() {
  const navigate = useReviewStore((s) => s.navigate);
  return (
    <button
      type="button"
      onClick={() => navigate({ name: 'center' })}
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--fg-2)] transition-colors hover:text-[var(--fg-1)]"
    >
      <span aria-hidden>←</span> command center
    </button>
  );
}

/**
 * The per-unit review drill-in (`/units/:id`). Reuses Phase 1's diff + streaming walkthrough,
 * topped with a thin identity header and tailed with a decision bar (Approve / Request changes)
 * that posts the verdict back over the same channel `await_decision` waits on. Authoritative load
 * is a direct fetch (so a hard refresh works); the live `units` snapshot keeps it fresh as the
 * review worker finishes and the brief streams in.
 */
export function UnitReview() {
  const route = useReviewStore((s) => s.route);
  const navigate = useReviewStore((s) => s.navigate);
  const accent = useReviewStore((s) => s.accent);
  const { markBg } = getAccentMeta(accent);
  const unitId = route.name === 'unit' ? route.unitId : null;
  const liveUnit = useReviewStore((s) => (unitId ? s.units.find((u) => u.unitId === unitId) : undefined));
  const narrative = useReviewStore((s) => s.narrative);

  const [unit, setUnit] = useState<Unit | null>(null);
  // Dedupe the lazy-hydrate POST: a github unit with no narrative triggers generation once per open.
  const hydratedRef = useRef<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Authoritative load — covers a hard refresh / deep link where the queue isn't in the store yet.
  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    setNotFound(false);
    void (async () => {
      try {
        const res = await fetch(`/api/units/${encodeURIComponent(unitId)}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { unit: Unit };
        if (!cancelled) {
          setUnit(data.unit);
          applyUnitToStore(data.unit);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load unit');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  // Live: when the unit advances (review worker queues it, brief streams in), re-apply.
  useEffect(() => {
    if (liveUnit) {
      setUnit(liveUnit);
      applyUnitToStore(liveUnit);
    }
  }, [liveUnit?.unitId, liveUnit?.updatedAt]);

  // Lazy narrative for github units: PRs aren't narrated until opened. Fire one hydrate POST when a
  // github unit with no narrative comes into view; the SSE `units` broadcast (and the response, as a
  // fallback) repaint the walkthrough when generation lands. Deduped per unit so SSE re-renders don't refire.
  useEffect(() => {
    if (!unitId || !unit) return;
    if (unit.source !== 'github' || unit.narrative) return;
    if (hydratedRef.current === unitId) return;
    hydratedRef.current = unitId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/hydrate`, { method: 'POST' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { unit: Unit };
        if (!cancelled && data.unit) {
          setUnit(data.unit);
          applyUnitToStore(data.unit);
        }
      } catch {
        // ignore — the SSE `units` stream still delivers the narrative when it's ready
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, unit?.source, unit?.narrative]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] px-6 pt-24 text-center text-[var(--fg-2)]">
        <p className="text-[15px] font-medium">That unit is gone.</p>
        <button
          type="button"
          onClick={() => navigate({ name: 'center' })}
          className="mt-3 text-[13px] font-medium text-[var(--blue-11)]"
        >
          ← back to the command center
        </button>
      </div>
    );
  }

  const status = unit?.status;
  const decidable = status === 'queued';

  async function decide(kind: 'approved' | 'changes_requested') {
    if (!unitId) return;
    setBusy(true);
    setError(null);
    try {
      await postDecision(unitId, {
        kind,
        note: note.trim() || undefined,
        concerns: kind === 'changes_requested' ? (unit?.narrative?.concerns ?? narrative?.concerns) : undefined,
      });
      navigate({ name: 'center' }); // the unit leaves the needs-you queue
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
      setBusy(false);
    }
  }

  async function retry() {
    if (!unitId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await retryUnit(unitId);
      if (r.ok === false) {
        setError(r.reason === 'clean-tree' ? 'Nothing to re-review — the working tree is clean.' : 'Could not retry.');
      }
      // else: the unit flips back to reviewing via SSE and the live effect repaints with the loader
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!unitId) return;
    setBusy(true);
    setError(null);
    try {
      await removeUnit(unitId);
      navigate({ name: 'center' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-28 text-[var(--fg-1)]">
      <header
        className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--bg-panel)] px-6 py-3"
        style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        <DadMark size={22} bg={markBg} shape="circle" showBadge={false} />
        <BackLink />
        <span className="text-[var(--fg-3)]">·</span>
        <span className="text-[13.5px] text-[var(--fg-3)]">{unit?.repo}</span>
        {unit?.metadata?.branch && (
          <span className="font-mono text-[12.5px] text-[var(--fg-3)]">{unit.metadata.branch}</span>
        )}
        <span className="truncate text-[13.5px] font-semibold text-[var(--fg-1)]">{unit?.taskLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          {unit?.source === 'github' && unit.prUrl && (
            <a
              href={unit.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--fg-2)] transition-colors hover:text-[var(--fg-1)]"
            >
              View on GitHub <span aria-hidden>↗</span>
            </a>
          )}
          <AccentPicker />
          <ThemeToggle />
        </div>
      </header>

      {error && (
        <div
          className="mx-auto mt-4 max-w-[1100px] rounded-lg px-3.5 py-2.5 text-[13px]"
          style={{ background: 'var(--red-3)', color: 'var(--red-11)', boxShadow: 'inset 0 0 0 1px var(--red-a6)' }}
        >
          {error}
        </div>
      )}

      {narrative ? (
        <StoryView />
      ) : unit?.error ? (
        <div className="mx-auto max-w-[1100px] px-6 pt-10 text-[14px] text-[var(--fg-2)]">
          <p className="font-medium text-[var(--red-11)]">Dad couldn't get through this one.</p>
          <p className="mt-1 font-mono text-[12.5px] text-[var(--fg-3)]">{unit.error}</p>
          <p className="mt-3">Retry the review, decide from the diff below, or clear it from the queue.</p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={retry}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--blue-9)' }}
            >
              Retry review
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--fg-2)] disabled:opacity-50"
              style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
            >
              Remove from queue
            </button>
          </div>
          <div className="mt-4">
            <ClassicView />
          </div>
        </div>
      ) : (
        <>
          <ReviewProgress />
          <ClassicView />
        </>
      )}

      {/* Decision bar — only when the unit is awaiting a verdict. */}
      {decidable && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 bg-[var(--bg-panel)] px-6 py-3"
          style={{ boxShadow: 'inset 0 1px 0 var(--gray-a4)' }}
        >
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3">
            <span className="text-[12.5px] text-[var(--fg-3)]">
              {unit && unit.toResolve > 0 ? `${unit.toResolve} to resolve before approving` : 'Ready for your verdict'}
            </span>
            {requesting && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What should the agent change? (optional)"
                className="min-w-0 flex-1 rounded-md bg-[var(--bg-page)] px-2.5 py-1.5 text-[13px] text-[var(--fg-1)]"
                style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
              />
            )}
            <div className="ml-auto flex items-center gap-2">
              {requesting ? (
                <>
                  <button
                    type="button"
                    onClick={() => setRequesting(false)}
                    disabled={busy}
                    className="rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--fg-2)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => decide('changes_requested')}
                    disabled={busy}
                    className="rounded-md px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
                    style={{ background: 'var(--amber-9)', color: 'var(--gray-12)' }}
                  >
                    Send changes
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setRequesting(true)}
                    disabled={busy}
                    className="rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--amber-11)] disabled:opacity-50"
                    style={{ background: 'var(--amber-3)', boxShadow: 'inset 0 0 0 1px var(--amber-a5)' }}
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    onClick={() => decide('approved')}
                    disabled={busy}
                    className="rounded-md px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--green-9)' }}
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
