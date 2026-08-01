import type { Broadcast } from '../mcp/broadcast';
import { classify, shouldResurface, shouldUndismiss } from '../units/linking';
import type { UnitStore } from '../units/store';
import type { PolledPr, ReviewUnit } from '../units/types';
import type { PrFileSummary, PRMetadata } from '../github/types';
import { type TriageSummary, triageFiles } from '../narrative/triage';
import { isDismissed, laneSplit, unitsPayload } from '../units/lane';

/**
 * Build the `PRMetadata` a freshly-minted `github` unit carries from the PR metadata the poller
 * fetched. The diff/line counts ride along on the `PolledPr` (the search already fetched each PR), so
 * the row shows real numbers at mint — no zero-fill until the lazy on-open hydrate. The
 * `headSha`/`branch`/`title`/`author`/`updatedAt` remain the load-bearing freshness fields.
 */
function metadataFromPr(pr: PolledPr): PRMetadata {
  return {
    number: pr.number,
    title: pr.title,
    body: '',
    state: 'open',
    draft: false,
    author: { login: pr.author, avatarUrl: '' },
    branch: pr.headBranch,
    base: pr.base,
    labels: [],
    createdAt: pr.updatedAt,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commits: pr.commits,
    headSha: pr.headSha,
    archived: pr.archived,
  };
}

/** Whether a unit's stored diff/line counts drift from the freshly-polled PR (so a heal is worth a write). */
function countsDiffer(meta: PRMetadata, pr: PolledPr): boolean {
  return (
    meta.additions !== pr.additions ||
    meta.deletions !== pr.deletions ||
    meta.changedFiles !== pr.changedFiles ||
    meta.commits !== pr.commits
  );
}

/**
 * One pass of the GitHub review-request poller: for each PR the (injected) search returns, classify it
 * against the current units and route it — mint a fresh `github` unit, or re-surface a reviewed
 * `github` unit whose head moved. A thin reducer over `classify` / `shouldResurface` (both pure) + the
 * store's synchronous mutators, so it's testable with a fake search and a real store. After the pass it
 * broadcasts a `units` snapshot over the daemon's SSE spine so the command center reflects the new inbox
 * immediately.
 *
 * PRs whose base repo is archived are dropped before any of that: GitHub serves archived repos
 * read-only, so approving or commenting would 403 and the PR is not work the reviewer can do. They are
 * never minted, and an existing (non-`pinned`) unit for one is removed — this runs with or without the
 * reconcile dep, since the search keeps returning them and the miss streak would never fire.
 *
 * With `fetchPrState` wired, the pass also reconciles the store against the search: a github unit whose
 * PR the search stopped returning is dropped — immediately if GitHub reports it closed/merged, else
 * after two consecutive missing polls (the miss streak absorbs the search's eventual consistency).
 * Exceptions: a still-open unit that is hydrated but undecided (mid-review) is never dropped, and
 * neither is a `pinned` unit (a PR the reviewer added by hand, which the search never lists). The
 * streak map is caller-owned so the interval poller and the manual /api/poll share one streak state.
 * Without the dep, reconciliation is skipped entirely (mint/resurface behavior is byte-identical).
 *
 * Returns counts for the caller's one-line log. The search/broadcast/fetch are injected (no network here).
 */
export async function pollOnce(deps: {
  search: () => Promise<PolledPr[]>;
  store: UnitStore;
  broadcast: Broadcast;
  fetchPrState?: (unit: ReviewUnit) => Promise<{ open: boolean }>;
  missStreaks?: Map<string, number>;
  /**
   * One page of a PR's file list — the triage inputs the queue's lane is computed from. Absent → triage
   * is skipped entirely and units mint without a summary, which `laneOf` reads as needs-you. Costs one
   * REST call per PR *per push*, never per poll.
   */
  fetchFileSummary?: (pr: { owner: string; repo: string; number: number }) => Promise<{
    files: PrFileSummary[];
    truncated: boolean;
  }>;
  /**
   * A unit's reviews rollup. Unlike the file summary this runs *per poll*, because approvals land
   * without a push — which is why it is the one genuinely recurring cost in the pass. Failures are
   * swallowed per-unit: a rollup is ordering information, and losing it must never fail a whole poll.
   */
  fetchReviews?: (unit: ReviewUnit) => Promise<{ approved: number; changesRequested: number }>;
}): Promise<{ minted: number; resurfaced: number; removed: number }> {
  const { search, store, broadcast, fetchPrState, missStreaks, fetchFileSummary, fetchReviews } = deps;
  const prs = await search();

  /** Fetch + classify a PR's files. `undefined` on any failure — never a fabricated empty summary,
   *  which would read as "we looked and found nothing" rather than "we never looked". */
  const triageFor = async (
    pr: { owner: string; repo: string; number: number },
    sha: string,
  ): Promise<TriageSummary | undefined> => {
    if (!fetchFileSummary) return undefined;
    try {
      const { files, truncated } = await fetchFileSummary(pr);
      return triageFiles(files, sha, truncated);
    } catch (err) {
      console.warn(
        `[diffdad] triage fetch failed for ${pr.owner}/${pr.repo}#${pr.number} — ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  };

  let minted = 0;
  let resurfaced = 0;
  let removed = 0;
  const removals: string[] = [];

  // GitHub serves archived repositories read-only: approving, commenting, and merging all fail. A PR
  // there is not work you can do, so it never enters the queue — and one already in it is dropped now
  // rather than left to the miss-streak path, which would never fire (the search still returns it).
  // `pinned` units are exempt, matching the reconciliation exemption below: reading an archived PR
  // still works, and a hand-added one was asked for by name.
  const archived = new Set<string>();
  for (const pr of prs) {
    if (pr.archived) archived.add(`${pr.owner}/${pr.repo}#${pr.number}`);
  }
  if (archived.size > 0) {
    for (const unit of store.list()) {
      if (unit.source !== 'github' || unit.prNumber === undefined || unit.pinned) continue;
      const key = `${unit.repo}#${unit.prNumber}`;
      if (!archived.has(key)) continue;
      await store.remove(unit.unitId);
      missStreaks?.delete(unit.unitId);
      removals.push(`${key} (archived repo)`);
      removed++;
    }
  }

  for (const pr of prs) {
    if (pr.archived) continue; // read-only upstream — never mint, never resurface
    const c = classify(store.list(), pr);
    if (c.kind === 'create') {
      store.addGithubUnit({
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        headBranch: pr.headBranch,
        headSha: pr.headSha,
        author: pr.author,
        url: pr.url,
        baseRef: pr.base,
        metadata: metadataFromPr(pr),
        triage: await triageFor(pr, pr.headSha),
      });
      minted++;
    } else {
      // existing-github: only re-open if the author pushed past the reviewed head.
      const unit = store.get(c.unitId);
      // A dismissed PR comes back the moment its author pushes past the SHA it was hidden at. Checked
      // before resurface because a dismissed unit is still `queued` — `shouldResurface` gates on a
      // reviewed status and would never fire for one.
      if (unit && shouldUndismiss(unit, pr.headSha)) {
        store.undismiss(unit.unitId);
      }
      // Re-triage on a new head: evidence gathered at one SHA must not outlive it. Without this, a push
      // that adds a source file to a docs-only PR leaves it sitting in the low-attention lane forever.
      if (unit && unit.triage && unit.triage.sha !== pr.headSha) {
        const fresh = await triageFor(pr, pr.headSha);
        if (fresh) store.setTriage(unit.unitId, fresh);
      }
      if (unit && shouldResurface(unit, pr.headSha)) {
        store.resurfaceForNewPush(c.unitId, pr.headSha);
        resurfaced++;
      }
      // Heal a unit whose stored counts drift from the live PR — minted before the counts rode along,
      // or the author pushed since. The search already fetched the PR, so this is free. Counts ONLY:
      // never status / reviewedSha / headSha. Skip when equal so an unchanged PR isn't rewritten each poll.
      if (unit && countsDiffer(unit.metadata, pr)) {
        store.setMetadataCounts(unit.unitId, {
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
          commits: pr.commits,
        });
      }
    }
  }

  // Reconcile against the authoritative search: drop units GitHub no longer lists on your plate.
  // Skipped without a `fetchPrState` dep so the mint/resurface-only callers stay byte-identical.
  if (fetchPrState) {
    const streaks = missStreaks ?? new Map<string, number>();
    // Search keys are `owner/repo#number`; a unit's `repo` is already `owner/name`.
    const polled = new Set(prs.map((pr) => `${pr.owner}/${pr.repo}#${pr.number}`));
    for (const unit of store.list()) {
      if (unit.source !== 'github' || unit.prNumber === undefined) continue;
      // Hand-added PRs are exempt: the reviewer typed one in precisely because GitHub was NOT asking
      // them to review it, so "absent from the review-request search" is its normal state, not evidence
      // it's finished. Reconciling it would delete the unit a minute or two after it was requested,
      // often mid-generation. It leaves the queue by the ✕ (DELETE /api/units/:id) alone.
      if (unit.pinned) {
        streaks.delete(unit.unitId);
        continue;
      }
      // Dismissed units are exempt too, and for a sharper reason: removing one *resurrects* it. The
      // dismissal lives on the unit, so a hard delete drops the stamp with it, and the next pass that
      // sees the PR mints a fresh unit with nothing recording that it was ever hidden. A search blip —
      // two eventually-consistent misses, which the comment below says is not evidence of anything —
      // would silently undo a dismissal at the same SHA. Archived removal above still wins, because
      // that PR cannot be acted on at all.
      if (isDismissed(unit)) {
        streaks.delete(unit.unitId);
        continue;
      }
      const key = `${unit.repo}#${unit.prNumber}`;
      if (polled.has(key)) {
        streaks.delete(unit.unitId); // still on your plate → reset any pending miss streak
        continue;
      }
      // Absent from the search. A single miss is not evidence (the search is eventually consistent
      // and skips per-PR enrichment on transient errors), so decide removal defensively.
      let state: { open: boolean };
      try {
        state = await fetchPrState(unit);
      } catch {
        continue; // transient fetch failure ≠ evidence: leave the unit and its streak untouched
      }
      if (!state.open) {
        // Closed or merged on GitHub — unambiguous, remove now (streak irrelevant).
        await store.remove(unit.unitId);
        streaks.delete(unit.unitId);
        removals.push(`${key} (closed)`);
        removed++;
      } else if (unit.status === 'queued' && unit.narrative) {
        // Mid-review: hydrated but undecided. "Unrequested" here is usually the reviewer's own
        // doing — submitting comments or a review dismisses the review request on GitHub — so
        // removal would destroy the walkthrough under the person reading it. Keep the unit; it
        // retires through the normal paths (a decision, the PR closing, or a manual delete).
        streaks.delete(unit.unitId);
      } else {
        // Still open but unrequested (withdrawn / reviewed off-plate / search lag) → remove only
        // after two consecutive missing polls.
        const next = (streaks.get(unit.unitId) ?? 0) + 1;
        if (next >= 2) {
          await store.remove(unit.unitId);
          streaks.delete(unit.unitId);
          removals.push(`${key} (no longer requested)`);
          removed++;
        } else {
          streaks.set(unit.unitId, next);
        }
      }
    }
  }

  // Outside the `fetchPrState` block: archived removals happen without a reconcile dep wired.
  if (removals.length > 0) {
    console.log(`[diffdad] reconciled queue: dropped ${removals.join(', ')}`);
  }

  // Backfill: units minted before triage existed carry no summary and would sit in needs-you forever
  // on the lane function's safe fallback. This is a per-EXISTING-unit heal, mirroring the countsDiffer
  // repair above — deliberately not part of the mint path, so a mint-time fetch counter never sees it.
  if (fetchFileSummary) {
    for (const unit of store.list()) {
      if (unit.source !== 'github' || unit.prNumber === undefined || unit.triage) continue;
      const [owner, repo] = unit.repo.split('/');
      if (!owner || !repo) continue;
      const fresh = await triageFor({ owner, repo, number: unit.prNumber }, unit.metadata.headSha);
      if (fresh) store.setTriage(unit.unitId, fresh);
    }
  }

  // Reviews rollup — the one per-poll cost in this pass. Scoped to units still awaiting the reviewer:
  // a dismissed or decided unit's ordering is not being looked at, so spending a request on it is pure
  // rate-limit burn against a ceiling this reaches around forty open units.
  if (fetchReviews) {
    for (const unit of store.list()) {
      if (unit.source !== 'github' || unit.status !== 'queued' || isDismissed(unit)) continue;
      try {
        store.setReviewRollup(unit.unitId, await fetchReviews(unit));
      } catch {
        // Ordering information, not correctness. Keep the previous rollup and move on — one flaky
        // reviews call must never take down a whole poll pass.
      }
    }
  }

  // The evidence behind "am I opening fewer PRs I didn't need to?" — a question no command can answer,
  // so the daemon writes down what it decided each pass rather than leaving it to recollection.
  const split = laneSplit(store.list());
  console.log(
    `[diffdad] lanes: ${store.list().filter((u) => !isDismissed(u)).length} tracked — ` +
      `${split['needs-you']} needs-you · ${split['probably-not']} probably-not · ` +
      `${split['in-flight']} in-flight · ${split.cleared} cleared`,
  );

  // `polledAt` marks this as a real GitHub check (interval or manual /api/poll), so the command
  // center stamps its "checked …" freshness caption only on true poll passes — not on the other
  // `units` broadcasts (decision/delete/hydrate/review/initial snapshot) that never re-query GitHub.
  // The split and the lane stamp both come from the shared builder the routes use, so this ninth
  // emission point can't drift from the other eight.
  broadcast('units', { ...unitsPayload(store.list()), polledAt: Date.now() });
  return { minted, resurfaced, removed };
}
