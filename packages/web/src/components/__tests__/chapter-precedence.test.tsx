// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collapseReason, initialCollapsed } from '../../lib/collapse';
import { useReviewStore } from '../../state/review-store';
import type { Chapter as ChapterType, CollapseDecision } from '../../state/types';
import { Chapter } from '../Chapter';

/**
 * Collapse precedence: one boolean, two seeds, one stated rule.
 *
 * Mounted in a real DOM (`happy-dom`, opted into per file — see `vite.config.ts`) because the seeds are
 * only half the behaviour. On both live paths the decision arrives *after* these chapters mount, and the
 * cases that matter are transitions: a decision landing on a mounted chapter, a reviewer's own toggle
 * outranking a decision that lands later, and the pre-existing `reviewed` false→true collapse still
 * firing. None of that is reachable through `renderToStaticMarkup`.
 */

const decision: CollapseDecision = {
  chapterIndex: 0,
  reason: 'src/legacy.ts has 0 known callers outside this PR',
  evidence: { kind: 'no-external-callers', files: ['src/legacy.ts'], knownCallers: 0 },
};

const chapter: ChapterType = {
  title: 'Rename the legacy helper',
  summary: 'Renames a helper.',
  whyMatters: 'Nothing else calls it.',
  risk: 'low',
  sections: [],
};

describe('collapsed seed', () => {
  it('collapses on a decision alone', () => {
    expect(initialCollapsed(false, decision)).toBe(true);
  });

  it('collapses on reviewed alone', () => {
    expect(initialCollapsed(true, undefined)).toBe(true);
  });

  it('collapses when both agree', () => {
    expect(initialCollapsed(true, decision)).toBe(true);
  });

  it('stays open when neither applies', () => {
    expect(initialCollapsed(false, undefined)).toBe(false);
  });
});

describe('reason precedence', () => {
  it('shows the decision reason on a chapter the reviewer has not marked', () => {
    expect(collapseReason(decision, false)).toBe(decision.reason);
  });

  it('defers to the reviewed treatment when the chapter is both', () => {
    // Both seeds produce the same collapsed row, so the conflict is invisible except here: the
    // reviewer's own action outranks the tool's inference.
    expect(collapseReason(decision, true)).toBeNull();
  });

  it('shows nothing for a reviewed chapter with no decision', () => {
    expect(collapseReason(undefined, true)).toBeNull();
  });

  it('shows nothing for an open chapter with no decision', () => {
    expect(collapseReason(undefined, false)).toBeNull();
  });
});

/**
 * A mounted `Chapter` plus the two levers the live paths pull on it: the `decision` prop (re-render) and
 * the store's `chapterStates` (which is what `reviewed` reads).
 */
function harness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const render = (props: { decision?: CollapseDecision }) =>
    act(() => {
      root.render(<Chapter index={0} chapter={chapter} decision={props.decision} />);
    });

  const header = () => {
    const el = container.querySelector('[role="button"][aria-expanded]');
    if (!el) throw new Error('chapter header not found');
    return el;
  };

  return {
    container,
    render,
    /** The header's own claim about its state — the same bit `collapsed` drives everywhere else. */
    isCollapsed: () => header().getAttribute('aria-expanded') === 'false',
    reasonText: () => container.querySelector('[data-collapse-reason]')?.textContent ?? null,
    toggle: () =>
      act(() => {
        header().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }),
    markReviewed: () =>
      act(() => {
        useReviewStore.setState({ chapterStates: { 'ch-0': 'reviewed' } });
      }),
    unmount: () =>
      act(() => {
        root.unmount();
      }),
  };
}

describe('mounted chapter', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useReviewStore.setState({ chapterStates: {}, storyStructure: 'chapters' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    useReviewStore.setState({ chapterStates: {} });
  });

  it('starts collapsed and states its reason when the decision is there at mount', () => {
    const h = harness();
    h.render({ decision });
    expect(h.isCollapsed()).toBe(true);
    expect(h.reasonText()).toContain('0 known callers outside this PR');
    h.unmount();
  });

  it('collapses when the decision arrives after mount', () => {
    // The common live path: streamed chapters mount from the plan under the same `ch-${idx}` keys, and a
    // cached narrative gets its boundary from the `collapse` SSE event. Seeding alone would leave the
    // divider above a run of expanded chapters.
    const h = harness();
    h.render({});
    expect(h.isCollapsed()).toBe(false);
    expect(h.reasonText()).toBeNull();

    h.render({ decision });
    expect(h.isCollapsed()).toBe(true);
    expect(h.reasonText()).toContain('0 known callers outside this PR');
    h.unmount();
  });

  it('leaves a chapter the reviewer opened alone when a later decision lands on it', () => {
    // Collapse is a default, and a default only applies while it is still the default.
    const h = harness();
    h.render({ decision });
    expect(h.isCollapsed()).toBe(true);

    h.toggle();
    expect(h.isCollapsed()).toBe(false);

    // A regeneration clears the boundary (the chapter array changed) and the next one re-establishes it.
    h.render({});
    h.render({ decision: { ...decision } });
    expect(h.isCollapsed()).toBe(false);
    h.unmount();
  });

  it('re-renders with a fresh decision object without pulling an open chapter shut', () => {
    // Every live comment or check update re-runs `decisionsByChapter`, so the prop identity changes
    // constantly while the decision itself does not.
    const h = harness();
    h.render({ decision });
    h.toggle();
    expect(h.isCollapsed()).toBe(false);

    h.render({ decision: { ...decision } });
    h.render({ decision: { ...decision } });
    expect(h.isCollapsed()).toBe(false);
    h.unmount();
  });

  it('still collapses on the reviewed false→true transition', () => {
    const h = harness();
    h.render({});
    expect(h.isCollapsed()).toBe(false);

    h.markReviewed();
    expect(h.isCollapsed()).toBe(true);
    h.unmount();
  });

  it('collapses on review even after the reviewer expanded the chapter by hand', () => {
    // Marking reviewed IS the reviewer acting, so it outranks whatever they did to the chevron a moment
    // earlier — unlike a decision, which must not.
    const h = harness();
    h.render({ decision });
    h.toggle();
    expect(h.isCollapsed()).toBe(false);

    h.markReviewed();
    expect(h.isCollapsed()).toBe(true);
    // `reviewed` wins the reason line too: the reviewer's own action outranks the tool's inference.
    expect(h.reasonText()).toBeNull();
    h.unmount();
  });

  it('keeps the chapter body mounted while collapsed, so a comment on it stays reachable', () => {
    // Collapse is a default, never a removal — the same principle `OrphanedInlineComments` encodes.
    const h = harness();
    h.render({ decision });
    expect(h.container.textContent).toContain(chapter.summary);
    h.unmount();
  });
});

describe('caller disclosure', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useReviewStore.setState({ chapterStates: {}, storyStructure: 'chapters' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function renderCallers(callers: { chapterIndex: number; callers: string[]; total: number }) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<Chapter index={0} chapter={chapter} callers={callers} />);
    });
    const html = container.innerHTML;
    act(() => root.unmount());
    return html;
  }

  it('lists the capped callers and states the overflow', () => {
    const html = renderCallers({
      chapterIndex: 0,
      callers: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
      total: 200,
    });
    expect(html).toContain('Imported by 200 unchanged files');
    expect(html).toContain('f.ts');
    expect(html).toContain('+194 more');
  });

  it('lists a short set without an overflow line', () => {
    const html = renderCallers({ chapterIndex: 0, callers: ['a.ts', 'b.ts', 'c.ts'], total: 3 });
    expect(html).toContain('Imported by 3 unchanged files');
    expect(html).not.toContain('more</li>');
  });

  it('renders no disclosure when nothing unchanged imports the chapter', () => {
    const html = renderCallers({ chapterIndex: 0, callers: [], total: 0 });
    expect(html).not.toContain('Imported by');
  });
});
