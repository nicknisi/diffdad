import { describe, expect, it, beforeEach } from 'vitest';
import { applyUnitToStore, draftAnchorKey, reviewDraftKey, useReviewStore } from '../review-store';
import { selectReviewReady, selectWalkthrough, selectOpenToResolve } from '../selectors';
import type { DiffFile, NarrativeResponse, Plan, Unit } from '../types';

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
    reviewKey: null,
    drafts: [],
    plan: null,
    pendingChapterThemeIds: new Set(),
    chapterStates: {},
    activeChapterId: null,
    view: 'story',
    narrationOverrides: {},
    chapterDensity: {},
    openLine: null,
    commentRangeStart: null,
    commentDrag: null,
    submitOpen: false,
    recap: null,
    recapStatus: 'idle',
    recapError: null,
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

describe('review draft isolation', () => {
  it('scopes same-number PR drafts by repository', () => {
    expect(reviewDraftKey('owner-a/repo', 42)).not.toBe(reviewDraftKey('owner-b/repo', 42));
    expect(reviewDraftKey('https://github.com/owner-a/repo', 42)).toBe('owner-a/repo#42');
  });

  it('upserts a single draft per inline anchor', () => {
    useReviewStore.setState({ reviewKey: 'owner/repo#42', drafts: [] });
    const store = useReviewStore.getState();
    store.upsertDraft({ id: 'one', body: 'First', path: 'src/a.ts', line: 2, side: 'RIGHT' });
    store.upsertDraft({ id: 'two', body: 'Second', path: 'src/a.ts', line: 2, side: 'RIGHT' });

    expect(useReviewStore.getState().drafts).toEqual([
      { id: 'two', body: 'Second', path: 'src/a.ts', line: 2, side: 'RIGHT' },
    ]);
  });

  it('keeps drafts at different anchors independent', () => {
    useReviewStore.setState({ reviewKey: 'owner/repo#42', drafts: [] });
    const store = useReviewStore.getState();
    // Same line number in two different files must not collide, nor with a chapter anchor.
    store.upsertDraft({ id: 'a', body: 'A', path: 'src/a.ts', line: 2, side: 'RIGHT' });
    store.upsertDraft({ id: 'b', body: 'B', path: 'src/b.ts', line: 2, side: 'RIGHT' });
    store.upsertDraft({ id: 'c', body: 'C', chapterIndex: 2 });

    expect(useReviewStore.getState().drafts.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('removeDraftsAt removes only the matching logical anchor', () => {
    useReviewStore.setState({ reviewKey: 'owner/repo#42', drafts: [] });
    const store = useReviewStore.getState();
    store.upsertDraft({ id: 'a', body: 'A', path: 'src/a.ts', line: 2, side: 'RIGHT' });
    store.upsertDraft({ id: 'b', body: 'B', path: 'src/b.ts', line: 2, side: 'RIGHT' });

    store.removeDraftsAt({ path: 'src/a.ts', line: 2 });

    expect(useReviewStore.getState().drafts.map((d) => d.id)).toEqual(['b']);
  });

  it('draftAnchorKey distinguishes file:line anchors from chapter anchors', () => {
    expect(draftAnchorKey({ path: 'src/a.ts', line: 2 })).not.toBe(draftAnchorKey({ path: 'src/b.ts', line: 2 }));
    expect(draftAnchorKey({ path: 'src/a.ts', line: 2 })).not.toBe(draftAnchorKey({ chapterIndex: 2 }));
    expect(draftAnchorKey({ body: 'no anchor' } as never)).toBeNull();
  });
});

describe('daemon unit transitions', () => {
  function mkUnit(over: Partial<Unit> = {}): Unit {
    return {
      unitId: 'u1',
      repo: 'owner/repo',
      taskLabel: 'PR #1',
      intent: '',
      status: 'queued',
      prNumber: 1,
      toResolve: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...over,
    };
  }

  it('coerces a stale recap view to story (units have no recap endpoint)', () => {
    useReviewStore.setState({ view: 'recap' });
    applyUnitToStore(mkUnit());
    expect(useReviewStore.getState().view).toBe('story');
  });

  it('preserves a files view across unit applies', () => {
    useReviewStore.setState({ view: 'files' });
    applyUnitToStore(mkUnit());
    expect(useReviewStore.getState().view).toBe('files');
  });

  it('a same-unit re-apply (SSE tick / hydrate) preserves in-flight review work', () => {
    applyUnitToStore(mkUnit());
    useReviewStore.setState({
      resolved: { 'beat-1': true },
      narrationOverrides: { 'ch-0': 'security lens prose' },
      chapterDensity: { 'ch-0': 'terse' },
      openLine: 'src/a.ts:R2',
    });
    useReviewStore.getState().upsertDraft({ id: 'd1', body: 'draft', path: 'src/a.ts', line: 2, side: 'RIGHT' });

    applyUnitToStore(mkUnit({ updatedAt: '2026-01-01T00:05:00Z' }));

    const s = useReviewStore.getState();
    expect(s.resolved).toEqual({ 'beat-1': true });
    expect(s.narrationOverrides).toEqual({ 'ch-0': 'security lens prose' });
    expect(s.chapterDensity).toEqual({ 'ch-0': 'terse' });
    expect(s.openLine).toBe('src/a.ts:R2');
  });

  it('switching to a different unit resets PR-scoped transient state', () => {
    applyUnitToStore(mkUnit());
    useReviewStore.setState({
      resolved: { 'beat-1': true },
      narrationOverrides: { 'ch-0': 'override' },
      chapterDensity: { 'ch-0': 'terse' },
      openLine: 'src/a.ts:R2',
      submitOpen: true,
      recapStatus: 'ready',
    });
    useReviewStore.getState().upsertDraft({ id: 'd1', body: 'draft', path: 'src/a.ts', line: 2, side: 'RIGHT' });

    applyUnitToStore(mkUnit({ unitId: 'u2', repo: 'owner/other', prNumber: 9 }));

    const s = useReviewStore.getState();
    expect(s.reviewKey).toBe('owner/other#9');
    expect(s.resolved).toEqual({});
    expect(s.narrationOverrides).toEqual({});
    expect(s.chapterDensity).toEqual({});
    expect(s.openLine).toBeNull();
    expect(s.submitOpen).toBe(false);
    expect(s.recapStatus).toBe('idle');
    expect(s.drafts).toEqual([]);
  });

  it('the same PR number in a different repository gets a fresh draft scope', () => {
    applyUnitToStore(mkUnit({ repo: 'owner-a/repo', prNumber: 42 }));
    useReviewStore.getState().upsertDraft({ id: 'a', body: 'A', path: 'f.ts', line: 1, side: 'RIGHT' });

    applyUnitToStore(mkUnit({ unitId: 'u2', repo: 'owner-b/repo', prNumber: 42 }));

    expect(useReviewStore.getState().reviewKey).toBe('owner-b/repo#42');
    expect(useReviewStore.getState().drafts).toEqual([]);
  });

  function mkUnitNarrative(chapterCount: number): NarrativeResponse {
    return {
      title: 't',
      tldr: '',
      verdict: 'safe',
      readingPlan: [],
      concerns: [],
      chapters: Array.from({ length: chapterCount }, (_, i) => ({
        title: `Ch ${i}`,
        summary: '',
        whyMatters: '',
        risk: 'low' as const,
        sections: [],
      })),
    };
  }

  it('a same-unit re-apply keeps the reviewer’s active chapter', () => {
    applyUnitToStore(mkUnit({ narrative: mkUnitNarrative(3) }));
    useReviewStore.getState().setActiveChapter('ch-2');

    applyUnitToStore(mkUnit({ narrative: mkUnitNarrative(3), updatedAt: '2026-01-01T00:05:00Z' }));

    expect(useReviewStore.getState().activeChapterId).toBe('ch-2');
  });

  it('a same-unit re-apply keeps non-positional selections like the discussion section', () => {
    applyUnitToStore(mkUnit({ narrative: mkUnitNarrative(2) }));
    useReviewStore.getState().setActiveChapter('discussion');

    applyUnitToStore(mkUnit({ narrative: mkUnitNarrative(2), updatedAt: '2026-01-01T00:05:00Z' }));

    expect(useReviewStore.getState().activeChapterId).toBe('discussion');
  });

  it('resets the active chapter when it no longer resolves or when switching units', () => {
    applyUnitToStore(mkUnit({ narrative: mkUnitNarrative(3) }));
    useReviewStore.getState().setActiveChapter('ch-2');

    // A regeneration shrank the narrative — ch-2 is out of range.
    applyUnitToStore(mkUnit({ narrative: mkUnitNarrative(2), updatedAt: '2026-01-01T00:05:00Z' }));
    expect(useReviewStore.getState().activeChapterId).toBe('ch-0');

    // Switching to a different unit always starts at the top.
    useReviewStore.getState().setActiveChapter('ch-1');
    applyUnitToStore(mkUnit({ unitId: 'u2', repo: 'owner/other', prNumber: 9, narrative: mkUnitNarrative(2) }));
    expect(useReviewStore.getState().activeChapterId).toBe('ch-0');
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
