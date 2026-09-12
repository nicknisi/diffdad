// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useReviewStore } from '../../state/review-store';
import type { PRData } from '../../state/types';
import { PrDescription } from '../PrDescription';

/**
 * Mounted in a real DOM (`happy-dom`, per-file opt-in) rather than `renderToStaticMarkup`:
 * the component reads `pr` from the zustand store, and the server snapshot always returns
 * *initial* state — a statically rendered one would render nothing no matter what was seeded.
 */
describe('PrDescription', () => {
  let root: Root | null = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    useReviewStore.setState({ pr: null });
  });

  it('renders the PR body as markdown, open by default', () => {
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
    act(() => useReviewStore.setState({ pr }));
    const el = mount();
    expect(el.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(el.textContent).toContain('Description');
    expect(el.querySelector('strong')?.textContent).toBe('description');
  });

  it('renders nothing when the PR has no body', () => {
    act(() =>
      useReviewStore.setState({
        pr: { body: '', title: 't', number: 1 } as unknown as PRData,
      }),
    );
    const el = mount();
    expect(el.querySelector('details')).toBeNull();
    expect(el.textContent).toBe('');
  });
});
