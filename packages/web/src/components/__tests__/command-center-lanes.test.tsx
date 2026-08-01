// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../lib/microcopy';
import { useReviewStore } from '../../state/review-store';
import type { TriageSummary, Unit } from '../../state/types';
import { CommandCenter } from '../CommandCenter';

/**
 * The four states the command center has to get right once there are four lanes.
 *
 * Mounted in a real DOM (`happy-dom`, opted into per file) rather than `renderToStaticMarkup`, because
 * `CommandCenter` reads the queue from zustand and the server snapshot always returns *initial* state —
 * a statically rendered one would assert an empty queue no matter what it was seeded with.
 *
 * `fetch` is stubbed to never settle so `loaded` stays false only where the cold-start branch is under
 * test; everywhere else it resolves empty and the seeded store wins.
 */

function mkTriage(over: Partial<TriageSummary> = {}): TriageSummary {
  return {
    files: over.files ?? [{ path: 'README.md', kind: 'docs', criticality: [] }],
    criticality: over.criticality ?? [],
    additions: over.additions ?? 4,
    deletions: over.deletions ?? 1,
    truncated: over.truncated ?? false,
    sha: over.sha ?? 'abc123',
    ...over,
  };
}

function mkUnit(over: Partial<Unit> = {}): Unit {
  return {
    unitId: 'u1',
    repo: 'workos/authkit',
    taskLabel: 'wire SAML callback',
    intent: 'intent',
    status: 'queued',
    toResolve: 0,
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
    ...over,
  };
}

let root: Root | null = null;

/**
 * Await the act, don't just run it: `useUnits` flips `loaded` in the fetch's `finally`, one microtask
 * after the initial render. A synchronous `act` captures the tree mid-cold-start, so every assertion
 * about the settled queue would silently read the loading branch instead.
 */
async function mount(units: Unit[], dismissed: Unit[] = []): Promise<string> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    useReviewStore.setState({ units, dismissed });
    root = createRoot(container);
    root.render(<CommandCenter />);
  });
  return container.textContent ?? '';
}

describe('command center — four lanes', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
    useReviewStore.setState({ units: [], dismissed: [] });
  });

  afterEach(() => {
    // Unmount rather than only clearing the body: a leaked root keeps its 10s interval alive and goes on
    // scheduling renders into the next test.
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    useReviewStore.setState({ units: [], dismissed: [] });
  });

  it('renders every populated lane, in order', async () => {
    const text = await mount([
      mkUnit({ unitId: 'a', lane: 'needs-you', triage: mkTriage({ criticality: ['auth'] }) }),
      mkUnit({ unitId: 'b', lane: 'probably-not', triage: mkTriage() }),
      mkUnit({ unitId: 'c', lane: 'in-flight', status: 'changes_requested' }),
      mkUnit({ unitId: 'd', lane: 'cleared', status: 'approved' }),
    ]);
    expect(text).toContain('Needs you');
    expect(text).toContain('Probably not');
    expect(text).toContain('In flight');
    expect(text).toContain('Cleared');
    // The rule is the product, so it is on the surface rather than one click into a drawer.
    expect(text).toContain('every file classified mechanical');
    expect(text.indexOf('Needs you')).toBeLessThan(text.indexOf('Probably not'));
    expect(text.indexOf('Probably not')).toBeLessThan(text.indexOf('In flight'));
  });

  it('omits the Probably not lane entirely when it is empty, rather than showing a zero', async () => {
    const text = await mount([mkUnit({ unitId: 'a', lane: 'needs-you' })]);
    expect(text).toContain('Needs you');
    expect(text).not.toContain('Probably not');
  });

  it('never claims "all clear" over rows that are merely dismissed', async () => {
    // ✕-ing the last visible row must not land on the empty state: the work is hidden, not gone, and the
    // count is the only thing that makes a dismissal reachable again.
    const text = await mount([], [mkUnit({ unitId: 'hidden', lane: 'needs-you', dismissedAtSha: 'deadbee' })]);
    expect(text).not.toContain('All clear');
    expect(text).toContain('1 dismissed until they push');
  });

  it('still shows the all-clear empty state when there is genuinely nothing', async () => {
    const text = await mount([], []);
    expect(text).toContain('All clear');
  });

  it('still shows the cold-start loader before the first snapshot lands', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {})); // never settles, so `loaded` stays false
    const text = await mount([], []);
    expect(text).toContain(copy.queueLoading);
    expect(text).not.toContain('All clear');
  });
});
