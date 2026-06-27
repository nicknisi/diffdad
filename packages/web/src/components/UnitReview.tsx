import { useEffect, useRef, useState } from 'react';
import { getAccentMeta } from '../lib/accents';
import { loadDrafts, pendingReviewComments, useReviewStore } from '../state/review-store';
import { reviewEndpoint, summarizeChecks, summarizeReviews } from '../lib/units-view';
import { useComments } from '../hooks/useComments';
import { postDecision, removeUnit, retryUnit } from '../hooks/useUnits';
import { AccentPicker } from './AccentPicker';
import { ClassicView } from './ClassicView';
import { DadMark } from './DadMark';
import { ReviewProgress } from './ReviewProgress';
import { StoryView } from './StoryView';
import { SubmitDialog } from './SubmitDialog';
import { ThemeToggle } from './ThemeToggle';
import type { AgentComment, ChapterState, CheckRun, PRReview, Unit } from '../state/types';

/**
 * Feed a unit's diff slice + brief into the review store so the existing review surface
 * (StoryView / ClassicView, both store-driven) renders it. We set state directly rather than
 * via `setData` so the per-unit reviewed/draft localStorage (keyed by `pr.number`, which is the
 * 0 sentinel for every local unit) can't bleed across units — each open starts fresh.
 *
 * Comments are intentionally NOT set here: they're loaded separately (and live, from GitHub for
 * github units) by the drill-in's comment effect. Clobbering them on every live re-apply would wipe
 * the loaded thread each time the unit's `updatedAt` ticks.
 */
function applyUnitToStore(unit: Unit): void {
  const narrative = unit.narrative ?? null;
  const chapterStates: Record<string, ChapterState> = {};
  if (narrative) narrative.chapters.forEach((_, i) => (chapterStates[`ch-${i}`] = 'reading'));
  useReviewStore.setState({
    pr: unit.metadata ?? null,
    files: unit.files ?? [],
    narrative,
    chapterStates,
    activeChapterId: narrative && narrative.chapters.length > 0 ? 'ch-0' : null,
    // Load this unit's batched draft comments (persisted per PR number). Idempotent on live re-apply,
    // so an SSE tick can't wipe drafts mid-review — and switching units loads the right PR's drafts.
    drafts: loadDrafts(unit.metadata?.number ?? 0),
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
  const mode = useReviewStore((s) => s.mode);
  const setComments = useReviewStore((s) => s.setComments);
  const setAgentComments = useReviewStore((s) => s.setAgentComments);
  const draftCount = useReviewStore((s) => pendingReviewComments(s.drafts).length);
  const clearDrafts = useReviewStore((s) => s.clearDrafts);
  const setCheckRuns = useReviewStore((s) => s.setCheckRuns);
  const setReviews = useReviewStore((s) => s.setReviews);
  const checkRuns = useReviewStore((s) => s.checkRuns);
  const reviews = useReviewStore((s) => s.reviews);
  const { refreshComments } = useComments();

  const [unit, setUnit] = useState<Unit | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
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

  // Load this unit's GitHub PR comments into the store so the existing comment UI (StoryView /
  // ClassicView threads + composer) works unchanged. `refreshComments` is unit-aware in command-center
  // mode. Clear first so switching units never flashes the prior unit's thread; re-fetch once the
  // narrative lands so inline comments map to their chapters (the server maps against unit.narrative).
  const hasNarrative = narrative !== null;
  useEffect(() => {
    if (!unitId) return;
    setComments([]);
    void refreshComments();
  }, [unitId, hasNarrative, setComments, refreshComments]);

  // Load this unit's agent comments (the "send to agent" loop) so they render inline through the same
  // pipeline as GitHub comments. Clear first so switching units never flashes the prior unit's thread;
  // the unit-scoped `agent-comment` SSE event keeps it live as the parked agent replies/resolves.
  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    setAgentComments([]);
    void (async () => {
      try {
        const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/agent-comments`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as AgentComment[];
        if (!cancelled && Array.isArray(data)) setAgentComments(data);
      } catch {
        // ignore — the SSE stream backfills
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, setAgentComments]);

  // Load this github unit's CI checks + reviews. Keyed on the head SHA too, so a new push (the SSE
  // `units` event updates the unit's metadata) re-fetches the status — modest liveness without a poll.
  const headSha = unit?.metadata?.headSha;
  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    setCheckRuns([]);
    setReviews([]);
    void (async () => {
      try {
        const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/status`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { checks: CheckRun[]; reviews: PRReview[] };
        if (cancelled) return;
        setCheckRuns(data.checks ?? []);
        setReviews(data.reviews ?? []);
      } catch {
        // ignore — status is best-effort context, not load-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, headSha, setCheckRuns, setReviews]);

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
  const isGithub = unit?.source === 'github';
  const checks = summarizeChecks(checkRuns);
  const rv = summarizeReviews(reviews);
  const showStatus = isGithub && (checkRuns.length > 0 || reviews.length > 0);

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

  // Submit a GitHub review for a github unit (COMMENT / APPROVE / REQUEST_CHANGES) with any batched
  // draft comments — the full PR-mode submit, scoped to this unit's PR via `reviewEndpoint`. A verdict
  // records locally and the unit leaves the queue, so we head back to the center; a plain COMMENT
  // stays put and re-loads comments so the just-posted drafts show as real threads.
  async function submitReview(resolution: 'comment' | 'approve' | 'request_changes', summary: string) {
    if (!unitId) return;
    setBusy(true);
    setError(null);
    try {
      const comments = pendingReviewComments(useReviewStore.getState().drafts);
      const res = await fetch(reviewEndpoint(mode, route), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: resolution, body: summary, comments }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Submit failed (${res.status})${detail ? `: ${detail}` : ''}`);
      }
      clearDrafts();
      setReviewOpen(false);
      if (resolution === 'comment') {
        await refreshComments(); // the drafts are real GitHub comments now — surface them
        setBusy(false);
      } else {
        navigate({ name: 'center' }); // verdict recorded; the unit is out of the needs-you queue
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
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

      {showStatus && (
        <div className="mx-auto mt-3 flex max-w-[1100px] flex-wrap items-center gap-x-5 gap-y-1 px-6 text-[12.5px]">
          {checkRuns.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <span className="font-medium text-[var(--fg-3)]">CI</span>
              {checks.passed > 0 && <span style={{ color: 'var(--green-11)' }}>✓ {checks.passed}</span>}
              {checks.failed > 0 && <span style={{ color: 'var(--red-11)' }}>✗ {checks.failed}</span>}
              {checks.running > 0 && <span style={{ color: 'var(--amber-11)' }}>◐ {checks.running}</span>}
              {checks.passed === 0 && checks.failed === 0 && checks.running === 0 && (
                <span className="text-[var(--fg-3)]">—</span>
              )}
            </span>
          )}
          {reviews.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <span className="font-medium text-[var(--fg-3)]">Reviews</span>
              {rv.approved > 0 && <span style={{ color: 'var(--green-11)' }}>✓ {rv.approved} approved</span>}
              {rv.changesRequested > 0 && (
                <span style={{ color: 'var(--red-11)' }}>✗ {rv.changesRequested} changes requested</span>
              )}
              {rv.approved === 0 && rv.changesRequested === 0 && (
                <span className="text-[var(--fg-3)]">comments only</span>
              )}
            </span>
          )}
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

      {/* GitHub units get the full review submission (Comment / Approve / Request changes + batched
          draft comments + AI-draftable summary) — the same dialog as PR mode, scoped to this PR. */}
      {decidable && isGithub && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 bg-[var(--bg-panel)] px-6 py-3"
          style={{ boxShadow: 'inset 0 1px 0 var(--gray-a4)' }}
        >
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3">
            <span className="text-[12.5px] text-[var(--fg-3)]">
              {draftCount > 0
                ? `${draftCount} inline ${draftCount === 1 ? 'comment' : 'comments'} ready to ship`
                : unit && unit.toResolve > 0
                  ? `${unit.toResolve} to resolve before approving`
                  : 'Ready for your review'}
            </span>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                disabled={busy}
                aria-keyshortcuts="s"
                className="rounded-md px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--green-9)' }}
              >
                {draftCount > 0 ? `Submit review · ${draftCount}` : 'Submit review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local (agent/cli) units have no GitHub PR — the verdict goes to the parked agent over the
          decision channel, so they keep the inline Approve / Request-changes bar. */}
      {decidable && !isGithub && (
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

      <SubmitDialog open={reviewOpen} onClose={() => setReviewOpen(false)} onSubmit={submitReview} />
    </div>
  );
}
