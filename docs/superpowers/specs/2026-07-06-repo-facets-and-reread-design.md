# Repo facet sidebar + per-PR re-read

Date: 2026-07-06 · Status: approved (options: sidebar facets; drill-in re-read at live SHA)

## Problem

1. The command center's repo filter is a native `<select>` — options are hidden until opened,
   unstyled, and carry no signal about where the work is.
2. A unit's narrative is generated once and cached on the head SHA frozen at mint time
   (`diffContentKey`). There is no way to regenerate it — not after the author pushes, not when
   the prose is bad.

## Design

### Repo facet sidebar (command center)

- Replace the header `<select>` (at `md` and up) with a left sidebar under the sticky header:
  a `nav` of facet buttons — **All** (total needs-you count) then one row per repo.
- Rows show the repo's short name + its **needs-you** count (counts always computed from the
  UNFILTERED unit list, so filtering never changes the counts). Sorted busiest-first.
- When more than one owner is present, group rows under small dim owner labels (`workos/`) so
  short names stay unambiguous; single-owner lists skip the label.
- Repos with zero needs-you units collapse behind a "quiet ▸" toggle row (they still hold
  in-flight/cleared units, so they must stay reachable).
- Active facet: accent-colored treatment (`var(--accent-*)` custom properties), `aria-current`.
  Selection drives the existing `repoFilter`/`setRepoFilter` in `useUnits` — no new state model.
- Sticky (`top` = header height) with its own overflow scroll. Below `md` the sidebar is hidden
  and the existing `<select>` remains as the fallback — small windows keep a working filter.
- Empty/loading states: sidebar renders only when `repos.length > 1` (same rule as the select).

### Per-PR re-read (drill-in)

- New button in the drill-in header: **⟳ Re-read** (microcopy voice; disabled + spinning while
  in flight).
- `POST /api/units/:id/hydrate` gains `{ "force": true }`:
  - Fetch the PR live via `client.getPR` → current head SHA (+ fresh title/branch metadata).
  - Advance the unit's `headSha`/`diffContentKey` to the live SHA (mirror the existing
    mint-time invariant in `units/store.ts`).
  - Regenerate the narrative with the cache **bypassed for reads** (still written), so same-SHA
    regenerations produce fresh prose instead of replaying the cached one.
  - Non-force hydrate behavior is unchanged (lazy first-open path).
- Route hardening: per-unit single-flight (concurrent hydrates for the same unit share one
  in-flight promise), mirroring `/api/poll`'s route-closure pattern.
- Frontend: clicking Re-read clears the local narrative view and shows the existing full
  loading state (bobbing dad), then repaints from the response / SSE `units` broadcast. Errors
  reuse the drill-in's `role="alert"` panel + Retry.

### Also in scope

- Fix the two remaining `var(--red-a6)` references in `CommandCenter.tsx` (token does not exist
  in `index.css` — the inset ring silently renders nothing). Use the same treatment as the
  drill-in error panel fix (`var(--red-9)`).

## Testing

- Route tests: force-hydrate advances the SHA + bypasses cache read; single-flight coalescing;
  non-force path unchanged.
- units-view tests for the facet count/grouping helper.
- UI: web tsc + Playwright drive (facet click filters + counts stay global; Re-read shows
  loading then fresh narrative; both themes).

## Out of scope

Poll cadence, auto re-hydrate on push detection, mobile-first sidebar, virtualized facet lists.
