// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useReviewStore } from '../../state/review-store';
import type { PRData } from '../../state/types';
import { PrDescription } from '../PrDescription';

/**
 * Mounted in a real DOM (`happy-dom`, per-file opt-in) rather than `renderToStaticMarkup`:
 * the component reads `pr` and `descriptionOpen` from the zustand store, and the server snapshot
 * always returns *initial* state — a statically rendered one would render nothing no matter what
 * was seeded.
 */
describe('PrDescription', () => {
  let root: Root | null = null;

  const pr: PRData = {
    number: 80,
    title: 'Show full PR description',
    body: 'The daemon is missing the PR **description**.',
    state: 'open',
    draft: false,
    author: { login: 'himynameisjonas', avatarUrl: '' },
    branch: 'feat/description',
    base: 'main',
    labels: [],
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
    additions: 10,
    deletions: 2,
    changedFiles: 2,
    commits: 1,
    headSha: 'abc123',
  };

  function mount(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => root!.render(<PrDescription />));
    return el;
  }

  afterEach(() => {
    root?.unmount();
    root = null;
    document.body.innerHTML = '';
    useReviewStore.setState({ pr: null, descriptionOpen: true });
  });

  it('renders the PR body as markdown, open by default', () => {
    act(() => useReviewStore.setState({ pr }));
    const el = mount();
    expect(el.textContent).toContain('Description');
    expect(el.querySelector('strong')?.textContent).toBe('description');
    expect(el.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders nothing when the PR has no body', () => {
    act(() =>
      useReviewStore.setState({
        pr: { body: '', title: 't', number: 1 } as unknown as PRData,
      }),
    );
    const el = mount();
    expect(el.textContent).toBe('');
  });

  it('collapses on click and the collapse survives a remount (view switches must not pop it open)', () => {
    act(() => useReviewStore.setState({ pr }));
    const el = mount();
    expect(el.querySelector('strong')).not.toBeNull();

    act(() => el.querySelector('button')!.click());
    expect(el.querySelector('strong')).toBeNull(); // body unrendered, not merely hidden

    // Remount — the state a view switch produces.
    root!.unmount();
    const el2 = mount();
    expect(el2.querySelector('strong')).toBeNull();
    expect(el2.textContent).toContain('Description'); // the toggle row remains
    expect(el2.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  });
});
