import { describe, expect, it, beforeEach } from 'vitest';
import { useReviewStore } from '../review-store';
import { selectReviewReady, selectWalkthrough, selectOpenToResolve } from '../selectors';
import type { DiffFile, NarrativeResponse, Plan } from '../types';

function mkFile(file: string): DiffFile {
  return {
    file,
    isNewFile: false,
    isDeleted: false,
    hunks: [{ header: '@@ -1,1 +1,2 @@', oldStart: 1, oldCount: 1, newStart: 1, newCount: 2, lines: [] }],
  };
}

beforeEach(() => {
  useReviewStore.setState({
    pr: null,
    narrative: null,
    files: [],
    resolved: {},
    plan: null,
    pendingChapterThemeIds: new Set(),
    chapterStates: {},
    activeChapterId: null,
  });
});

describe('diff-first gate', () => {
  it('is review-ready (not blocked) when files are present but the narrative is still pending', () => {
    useReviewStore.setState({ files: [mkFile('src/a.ts')], narrative: null });
    const s = useReviewStore.getState();
    expect(selectReviewReady(s)).toBe(true);
    expect(selectWalkthrough(s)).toBeNull(); // diff renders immediately; the guide has not streamed yet
  });

  it('blocks (the brief pre-files instant) only when there are neither files nor a narrative', () => {
    useReviewStore.setState({ files: [], narrative: null });
    expect(selectReviewReady(useReviewStore.getState())).toBe(false);
  });

  it('surfaces a beat once a streamed plan/chapter arrives over the visible diff', () => {
    useReviewStore.setState({ files: [mkFile('src/a.ts')], narrative: null });
    const plan: Plan = {
      schemaVersion: 1,
      prTitle: 'T',
      prTldr: '',
      prVerdict: 'safe',
      themes: [{ id: 't1', title: 'Theme One', riskLevel: 'high', rationale: 'r', hunkRefs: [] }],
      readingPlan: [],
      concerns: [],
    };
    useReviewStore.getState().applyPlan(plan);
    const after = selectWalkthrough(useReviewStore.getState());
    expect(after).not.toBeNull();
    expect(after!.beats).toHaveLength(1);
    expect(after!.beats[0]!.title).toBe('Theme One');
    expect(after!.beats[0]!.risk).toBe('risk'); // high-risk theme
  });
});

describe('resolved overlay', () => {
  it('decrements the open to-resolve count when an item is resolved', () => {
    const narrative: NarrativeResponse = {
      title: 't',
      tldr: '',
      verdict: 'caution',
      readingPlan: [],
      concerns: [{ question: 'why?', file: 'src/a.ts', line: 2, category: 'logic', why: 'w' }],
      chapters: [
        {
          title: 'C',
          summary: '',
          whyMatters: '',
          risk: 'medium',
          sections: [{ type: 'diff', file: 'src/a.ts', startLine: 1, endLine: 5, hunkIndex: 0 }],
        },
      ],
    };
    useReviewStore.setState({ files: [mkFile('src/a.ts')], narrative });

    expect(selectOpenToResolve(useReviewStore.getState())).toBe(1);

    const item = selectWalkthrough(useReviewStore.getState())!.beats[0]!.resolve[0]!;
    useReviewStore.getState().setResolved(item.id, true);

    expect(selectOpenToResolve(useReviewStore.getState())).toBe(0);
  });
});
