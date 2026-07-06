# Manual refresh for the command center

Date: 2026-07-06 · Status: approved (option: button + result toast)

## Problem

The command center's PR list only updates when the daemon's GitHub review-request poller fires
(every 60s, `startPoller` → `pollOnce`) and pushes a `units` snapshot over SSE. There is no way to
say "check GitHub now," and no signal of how fresh the list is.

## Design

### Backend

- `DaemonAppDeps` gains an optional `pollNow?: () => Promise<{ minted: number; resurfaced: number }>`,
  following the injected-dep pattern of `hydrate`/`reviewPoster`.
- New route `POST /api/poll` (before the static catch-all):
  - No `pollNow` dep (GitHub not wired) → 503 `{ error }`.
  - Success → `{ ok: true, minted, resurfaced }`.
  - Failure → `console.error` one line + 502 `{ error }` (mirrors the hydrate route's logging).
  - **Single-flight at the route**: concurrent POSTs share one in-flight `pollNow()` promise, so
    button-mashing coalesces into a single GitHub search. (Route-level rather than wiring-level so
    `units-routes.test.ts` can cover it.) Overlap with the interval poller is benign — `classify`
    dedupes.
- `daemon.ts` wires `pollNow` to the same `pollOnce({ search, store, broadcast })` the interval
  uses. The SSE `units` broadcast inside `pollOnce` repaints every open tab; the response counts
  exist only for the toast.

### Frontend

- Review store: `lastUnitsAt: number | null`; the `units` SSE handler in `useLiveStream` stamps it.
  (`pollOnce` broadcasts on every pass, so this is an honest freshness signal with no new backend.)
- CommandCenter header, next to the live dot:
  - Dim caption `checked 42s ago` (seconds granularity, ticks on an interval).
  - Quiet labeled `↻ Refresh` button; disabled + spinning while the POST is in flight.
  - Transient toast (~4s, `aria-live="polite"`) with the result: counts ("2 new, 1 back for
    another look") or "nothing new"; errors reuse the red banner treatment. Copy in the
    `lib/microcopy` voice; all colors via CSS custom properties.

### Testing

- `units-routes.test.ts`: 503 without dep; counts pass-through; 502 + `console.error` on throw;
  single-flight (two concurrent POSTs → one `pollNow` invocation, both 200).
- UI: vite build typecheck + Playwright drive against a live daemon (click Refresh, observe POST
  and toast).

## Out of scope

Poll cadence changes, per-unit refresh, pull-to-refresh gestures.
