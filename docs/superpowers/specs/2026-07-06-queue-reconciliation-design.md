# Queue reconciliation — drop reviewed/closed/merged PRs

Date: 2026-07-06 · Status: approved (user: "If I have already reviewed a PR or if it's already
been closed/merged, then it should no longer appear in the list on the command center.")

## Problem

The poller only ADDS (mint/resurface). Units never leave the store when GitHub stops asking —
review submitted (via dad or on github.com), PR closed, PR merged, request withdrawn. The queue
accumulates stale rows (observed live: ~54 units, most 9 days old).

## Design

The search (`is:open is:pr review-requested:@me` + `is:open is:pr assignee:@me`, merged) is the
authoritative "on your plate" set. Reconcile against it every poll pass, in `pollOnce`:

1. After the existing mint/resurface loop, compute the set of polled PR keys (`owner/repo#number`).
2. For every stored `github` unit NOT in that set, decide removal defensively — the search is
   eventually consistent and its per-PR enrichment already skips PRs on transient errors, so a
   single miss must never delete on its own:
   - Fetch the PR directly (injected `fetchPrState(unit)` dep; daemon wires `client.getPR`).
     **Closed or merged → remove immediately** (GitHub is unambiguous).
   - Still open (request withdrawn / reviewed while not assignee / search lag) → count a **miss
     streak** (in-memory map keyed by unitId, reset whenever the unit appears in results).
     Remove at **2 consecutive missing polls** (~2 min at the 60s cadence).
   - Fetch failed → do nothing this pass (transient network ≠ evidence).
3. Removal = `store.remove` (same hard delete as the ✕ button). The pass's existing `units`
   broadcast repaints every tab; no new events.

Consequences, intentional:

- A PR reviewed through dad's drill-in transitions to `approved`/`changes_requested`, GitHub
  clears the review request, and the unit disappears within a poll or two — the cleared sections
  become transient by design.
- Decided units STILL PRESENT in the search (e.g. you're an assignee) are kept — they're the
  resurface machinery's memory, and GitHub still lists them on your plate.
- If a removed PR is re-requested later, the next poll mints a fresh unit (classify already
  handles this) — a new review cycle, not a resurrection.

### Counts & copy

`pollOnce` returns `{ minted, resurfaced, removed }`; `/api/poll` passes `removed` through; the
refresh toast copy in `lib/microcopy.ts` folds it in ("2 new, 3 cleared out." / "Nothing new.
3 cleared out." etc. — dad voice, singular/plural handled).

### Daemon log

One line per pass when it removed anything (repo#pr + reason closed/merged/unrequested), matching
the poller's existing log voice.

## Testing

Poller tests (fake search + fake fetchPrState + real store): closed → removed same pass;
merged → removed; open-but-missing → survives one pass, removed after two; present unit resets
the streak; fetch error → untouched; non-github units (if any remain) untouched; counts returned;
decided-but-present unit kept. Route test: `/api/poll` response carries `removed`. Microcopy
unit tests for the new count combinations.

## Out of scope

Webhooks/instant removal on review submit (poll cadence is fine), soft-delete/archive, undo.
