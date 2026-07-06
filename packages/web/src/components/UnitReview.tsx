import { useEffect, useRef, useState } from 'react';
import { getAccentMeta } from '../lib/accents';
import { copy } from '../lib/microcopy';
import { loadDrafts, pendingReviewComments, useReviewStore } from '../state/review-store';
import { reviewEndpoint, summarizeChecks, summarizeReviews } from '../lib/units-view';
import { useComments } from '../hooks/useComments';
import { AccentPicker } from './AccentPicker';
import { ClassicView } from './ClassicView';
import { DadMark } from './DadMark';
import { ReviewProgress } from './ReviewProgress';
import { StoryView } from './StoryView';
import { SubmitDialog } from './SubmitDialog';
import { ThemeToggle } from './ThemeToggle';
import type { ChapterState, CheckRun, PRReview, Unit } from '../state/types';

/**
 * Feed a unit's diff slice + brief into the review store so the existing review surface
 * (StoryView / ClassicView, both store-driven) renders it. We set state directly rather than
 * via `setData` so the per-unit reviewed/draft localStorage (keyed by `pr.number`) can't bleed
 * across units — each open starts fresh.
 *
 * Comments are intentionally NOT set here: they're loaded live from GitHub by the drill-in's
 * comment effect. Clobbering them on every live re-apply would wipe the loaded thread each time
 * the unit's `updatedAt` ticks.
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

/**
 * Make a raw hydrate failure safe to show under Dad's folksy heading. Server-side generation errors
 * carry a diagnostic tail — an escaped raw-response snippet and internal theme ids (see
 * `rawResponseSnippet` / `parseChapterResponse` on the CLI side) — that belongs in the daemon log, not
 * in the UI, where it reads as tonal whiplash and leaks internals. Drop the `— raw response …` suffix
 * and collapse the writer's non-JSON failure to a plain sentence; already-human messages (daemon
 * unreachable, empty narrative, bare HTTP status) pass through untouched.
 */
function friendlyHydrateError(raw: string): string {
  const base = (raw.split(' — raw response')[0] ?? raw).trim();
  if (/returned non-JSON/i.test(base)) {
    return "The writer came back with something Dad couldn't parse. This is usually temporary — hit Retry.";
  }
  return base;
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
 * The per-unit review drill-in (`/units/:id`) — always the GitHub experience now. Reuses the diff +
 * streaming walkthrough, topped with a thin identity header and tailed with the GitHub review bar
 * (Comment / Approve / Request changes via {@link SubmitDialog}). Authoritative load is a direct
 * fetch (so a hard refresh works); the live `units` snapshot keeps it fresh as the brief streams in.
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
  const [busy, setBusy] = useState(false);
  // Lazy-hydrate failure surface: a failed narrative generation lands here instead of spinning forever.
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  // Bumped by Retry / Re-read to re-run the hydrate effect — its [unitId, unit?.narrative] deps don't
  // change on retry (nor on a re-read, where a narrative already exists).
  const [retryNonce, setRetryNonce] = useState(0);
  // Re-read (force regeneration): the flag is consumed by the shared hydrate effect so it POSTs
  // { force: true } and doesn't bail on the existing narrative. `rereading` drives the button's
  // spinning/disabled state. Kept a ref (not a dep) so toggling it doesn't itself re-run the effect.
  const forceRef = useRef(false);
  const [rereading, setRereading] = useState(false);

  // Authoritative load — covers a hard refresh / deep link where the queue isn't in the store yet.
  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    setNotFound(false);
    setHydrateError(null); // switching units: drop the prior unit's hydrate error so it can't render stale
    setRereading(false); // and any in-flight re-read state — the new unit starts clean
    forceRef.current = false;
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

  // Lazy narrative: PRs aren't narrated until opened. Fire one hydrate POST when a unit with no
  // narrative comes into view; the SSE `units` broadcast (and the response, as a fallback) repaint
  // the walkthrough when generation lands. Deduped per unit so SSE re-renders don't refire. Any
  // failure lands in `hydrateError` (rendered as a retry panel) rather than spinning forever.
  // `hasUnit` must be a dep: on a deep link the unit loads async, and `unit?.narrative` is
  // undefined both before and after it arrives — without it the effect never re-runs and the
  // POST never fires.
  const hasUnit = unit !== null;
  useEffect(() => {
    if (!unitId || !unit) return;
    // Consume the re-read intent for this run: a forced pass regenerates even when a narrative already
    // exists, and dedupe never applies. Reading + clearing it here keeps a stale flag from leaking into
    // the next unit's lazy open.
    const force = forceRef.current;
    forceRef.current = false;
    if (unit.narrative && !force) return;
    if (hydratedRef.current === unitId && !force) return;
    hydratedRef.current = unitId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/hydrate`, {
          method: 'POST',
          // Only the re-read sends a body; the lazy open posts nothing, so the daemon takes the plain
          // non-force path (and any absent/invalid body stays a plain hydrate, never a 400).
          ...(force ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) } : {}),
        });
        if (cancelled) return;
        if (!res.ok) {
          const message = await res
            .json()
            .then((body: { error?: string }) => body?.error)
            .catch(() => undefined);
          if (!cancelled) setHydrateError(message || `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { unit: Unit };
        if (cancelled) return;
        if (data.unit?.narrative) {
          setUnit(data.unit);
          applyUnitToStore(data.unit);
        } else {
          // Graceful no-op path (e.g. GitHub not wired): 200 OK but nothing to show — don't spin.
          setHydrateError('The daemon returned no narrative for this PR.');
        }
      } catch {
        if (!cancelled) setHydrateError('Could not reach the daemon — is it still running?');
      } finally {
        setRereading(false); // clear the re-read spinner whether it landed, failed, or was superseded
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, hasUnit, unit?.narrative, retryNonce]);

  // Re-read: reviewer-triggered force regeneration. Reuse the hydrate effect above — clear the shown
  // narrative so the existing full loading state (bobbing dad / ReviewProgress) renders, flag the next
  // run as forced, and bump the nonce to fire it. Failures land in the same hydrateError panel + Retry.
  function reRead() {
    if (!unitId || rereading) return;
    setRereading(true);
    setError(null);
    setHydrateError(null);
    forceRef.current = true;
    hydratedRef.current = null; // clear dedupe so the effect doesn't short-circuit this unit
    useReviewStore.setState({ narrative: null });
    setRetryNonce((n) => n + 1);
  }

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
  const checks = summarizeChecks(checkRuns);
  const rv = summarizeReviews(reviews);
  const showStatus = checkRuns.length > 0 || reviews.length > 0;

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
          <button
            type="button"
            onClick={reRead}
            disabled={rereading || !narrative}
            title={copy.rereadTitle}
            aria-label={copy.rereadTitle}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--fg-2)] transition-colors hover:text-[var(--fg-1)] disabled:opacity-50"
          >
            <span className={rereading ? 'animate-spin' : ''} aria-hidden>
              ⟳
            </span>
            {rereading ? copy.rereadBusy : copy.rereadLabel}
          </button>
          {unit?.prUrl && (
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
          style={{ background: 'var(--red-3)', color: 'var(--red-11)', boxShadow: 'inset 0 0 0 1px var(--red-9)' }}
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
      ) : hydrateError ? (
        <>
          {/* Hydrate failed — an explicit, retryable panel in place of the eternal spinner. The raw diff
              (ClassicView) stays below so the PR is still readable while narration is down. */}
          <div className="mx-auto max-w-[1100px] px-6 pt-4">
            <div
              role="alert"
              className="flex items-start gap-3 rounded-[10px] px-4 py-3.5"
              style={{ background: 'var(--red-2)', boxShadow: 'inset 0 0 0 1px var(--red-9)' }}
            >
              <div className="mt-0.5 shrink-0">
                <DadMark size={30} bg={markBg} shape="circle" showBadge={false} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold" style={{ color: 'var(--red-11)' }}>
                  Dad couldn&apos;t find the story in this one.
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed break-words" style={{ color: 'var(--fg-2)' }}>
                  {friendlyHydrateError(hydrateError)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  // A re-read failure leaves the OLD narrative in local `unit` state (reRead only nulls the
                  // store copy), so a plain retry would bail on `unit.narrative && !force` and strand the
                  // spinner. When a narrative is present the failed pass was necessarily a force re-read
                  // (lazy open only fires with no narrative), so re-run it through reRead() to actually
                  // regenerate; a lazy first-open failure (no narrative yet) just re-fires the effect.
                  if (unit?.narrative) {
                    reRead();
                    return;
                  }
                  setHydrateError(null);
                  hydratedRef.current = null;
                  setRetryNonce((n) => n + 1);
                }}
                className="shrink-0 self-center rounded-md px-4 py-1.5 text-[13px] font-semibold text-white"
                style={{ background: 'var(--red-9)' }}
              >
                Retry
              </button>
            </div>
          </div>
          <ClassicView />
        </>
      ) : (
        <>
          <ReviewProgress />
          <ClassicView />
        </>
      )}

      {/* The full review submission (Comment / Approve / Request changes + batched draft comments +
          AI-draftable summary) — the same dialog as PR mode, scoped to this unit's PR. */}
      {decidable && (
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

      <SubmitDialog open={reviewOpen} onClose={() => setReviewOpen(false)} onSubmit={submitReview} />
    </div>
  );
}
