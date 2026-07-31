import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COLLAPSE_UNAVAILABLE_TEXT, collapsedSummary, dividerIndex, truncationSummary } from '../../lib/collapse';
import type { CapStats, Chapter as ChapterType, CollapseResult, CollapseUnavailableReason } from '../../state/types';
import { CollapseDivider, CollapseUnavailableNotice, TruncationBanner } from '../StoryView';

/**
 * The divider, the unavailable notice, and the truncation banner.
 *
 * Rendered through `react-dom/server` rather than a DOM: the web suite runs vitest in the node
 * environment with no jsdom, and zustand's server snapshot always returns the store's *initial* state —
 * so a store-driven component like `StoryView` renders empty here. These three take props, which is why
 * they are exported and why placement itself is asserted through the pure helpers `StoryView` uses.
 */

function chapter(title: string, lines: number): ChapterType {
  return {
    title,
    summary: '',
    whyMatters: '',
    risk: 'low',
    sections: lines > 0 ? [{ type: 'diff', file: `src/${title}.ts`, startLine: 1, endLine: lines, hunkIndex: 0 }] : [],
  };
}

const chapters = [chapter('one', 100), chapter('two', 200), chapter('three', 300), chapter('four', 400)];

function collapsedFrom(indices: number[], dividerBefore: number | null): CollapseResult {
  return {
    available: true,
    dividerBefore,
    decisions: indices.map((chapterIndex) => ({
      chapterIndex,
      reason: `src/x${chapterIndex}.ts has 0 known callers outside this PR`,
      evidence: { kind: 'no-external-callers', files: [`src/x${chapterIndex}.ts`], knownCallers: 0 },
    })),
  };
}

describe('divider placement', () => {
  it('renders nothing when dividerBefore is null', () => {
    // Decisions exist but they are not a contiguous run at the end of the list, so the server withheld
    // the boundary. Nothing must render — no divider, no summary, no empty state.
    const collapse = collapsedFrom([1], null);
    expect(dividerIndex(collapse)).toBeNull();
    expect(collapsedSummary(collapse, chapters)).toBeNull();
  });

  it('places the divider at index 0 when every chapter collapses', () => {
    const collapse = collapsedFrom([0, 1, 2, 3], 0);
    expect(dividerIndex(collapse)).toBe(0);
    expect(collapsedSummary(collapse, chapters)).toEqual({
      count: 4,
      lines: 1000,
      evidence: 'no known callers outside this PR',
    });
  });

  it('places the divider mid-list and counts only the chapters below it', () => {
    const collapse = collapsedFrom([2, 3], 2);
    expect(dividerIndex(collapse)).toBe(2);
    expect(collapsedSummary(collapse, chapters)?.count).toBe(2);
    expect(collapsedSummary(collapse, chapters)?.lines).toBe(700);
  });

  it('renders nothing at all when collapse is unavailable', () => {
    const collapse: CollapseResult = { available: false, reason: 'size-cap' };
    expect(dividerIndex(collapse)).toBeNull();
    expect(collapsedSummary(collapse, chapters)).toBeNull();
  });

  it('renders nothing when the server sent no collapse result', () => {
    expect(dividerIndex(null)).toBeNull();
    expect(collapsedSummary(null, chapters)).toBeNull();
  });

  it('says mixed evidence when the collapsed chapters do not agree', () => {
    const collapse: CollapseResult = {
      available: true,
      dividerBefore: 2,
      decisions: [
        {
          chapterIndex: 2,
          reason: '2 test files, no source files',
          evidence: { kind: 'test-only', files: ['a.test.ts', 'b.test.ts'] },
        },
        {
          chapterIndex: 3,
          reason: 'src/gen.ts is generated or vendored',
          evidence: { kind: 'generated', files: ['src/gen.ts'] },
        },
      ],
    };
    expect(collapsedSummary(collapse, chapters)?.evidence).toBe('mixed evidence');
  });
});

describe('divider copy', () => {
  it('states chapters, lines and the evidence, with the count grouped', () => {
    const html = renderToStaticMarkup(
      <CollapseDivider summary={{ count: 4, lines: 1180, evidence: 'no known callers outside this PR' }} />,
    );
    expect(html).toContain('4 chapters below');
    expect(html).toContain('1,180 lines');
    expect(html).toContain('no known callers outside this PR');
  });

  it('speaks in the singular for one chapter and one line', () => {
    const html = renderToStaticMarkup(<CollapseDivider summary={{ count: 1, lines: 1, evidence: 'tests only' }} />);
    expect(html).toContain('1 chapter below');
    expect(html).toContain('1 line ');
  });
});

describe('unavailable notice', () => {
  // Typed over the union itself and passed straight to the component, so a reason that is renamed or
  // dropped is a compile error here rather than a silently unasserted branch.
  const cases: [CollapseUnavailableReason, string][] = [
    ['size-cap', 'size cap'],
    ['fetch-failed', 'downloaded'],
    ['extract-failed', 'extracted'],
    ['empty-tree', 'no source files'],
  ];

  it('covers every reason the notice can render', () => {
    // Typing the table over the union catches a rename but not an omission — a fifth reason added to the
    // snapshot layer would type-check as a three-of-four table. This asserts completeness against the
    // `Record` the copy itself lives in, which is what makes the loop below exhaustive.
    expect(cases.map(([reason]) => reason).sort()).toEqual(Object.keys(COLLAPSE_UNAVAILABLE_TEXT).sort());
  });

  for (const [reason, expected] of cases) {
    it(`names its cause for ${reason}`, () => {
      const html = renderToStaticMarkup(<CollapseUnavailableNotice collapse={{ available: false, reason }} />);
      expect(html).toContain('Blast radius unavailable');
      expect(html).toContain(expected);
      expect(html).toContain('Nothing was collapsed');
    });
  }

  it('renders nothing when collapse is available', () => {
    const html = renderToStaticMarkup(
      <CollapseUnavailableNotice collapse={{ available: true, decisions: [], dividerBefore: null }} />,
    );
    expect(html).toBe('');
  });

  it('renders nothing when the server sent no collapse result', () => {
    // "Not checked" is a different claim from "checked and could not tell" — only the second gets a notice.
    expect(renderToStaticMarkup(<CollapseUnavailableNotice collapse={null} />)).toBe('');
  });
});

describe('truncation banner', () => {
  function capStats(overrides: Partial<CapStats> = {}): CapStats {
    return {
      perFileCap: 500,
      globalCap: 12000,
      inputFileCount: 40,
      inputLineCount: 20000,
      narratedFileCount: 30,
      narratedLineCount: 12000,
      truncatedFiles: [],
      droppedFiles: [],
      ...overrides,
    };
  }

  it('renders nothing when capStats is absent', () => {
    // A cache hit measured no diff. Claiming completeness that was never verified is worse than silence.
    expect(truncationSummary(null)).toBeNull();
    expect(renderToStaticMarkup(<TruncationBanner capStats={null} />)).toBe('');
  });

  it('renders nothing when the whole diff fit inside the budget', () => {
    expect(truncationSummary(capStats())).toBeNull();
    expect(renderToStaticMarkup(<TruncationBanner capStats={capStats()} />)).toBe('');
  });

  it('states both counts when files were dropped and shortened', () => {
    const stats = capStats({
      droppedFiles: ['a.ts', 'b.ts'],
      truncatedFiles: [{ file: 'c.ts', hunksDropped: 2, linesDropped: 300 }],
    });
    expect(truncationSummary(stats)).toEqual({ dropped: 2, shortened: 1 });
    const html = renderToStaticMarkup(<TruncationBanner capStats={stats} />);
    expect(html).toContain('partial diff');
    expect(html).toContain('2 files dropped');
    expect(html).toContain('1 file shortened');
  });

  it('states only the count that happened', () => {
    const stats = capStats({ droppedFiles: ['a.ts'] });
    const html = renderToStaticMarkup(<TruncationBanner capStats={stats} />);
    expect(html).toContain('1 file dropped');
    expect(html).not.toContain('shortened');
  });
});
