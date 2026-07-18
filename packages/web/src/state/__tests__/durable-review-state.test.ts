import { describe, expect, it, beforeEach } from 'vitest';
import { chapterContentKey, loadResolved, useReviewStore } from '../review-store';
import { buildWalkthrough, findingKey } from '../../lib/walkthrough';
import type { DiffFile, NarrativeResponse, Plan, PRData } from '../types';

// The store's safeStorage no-ops without a localStorage global (node test env), which would make
// every persistence assertion vacuously pass. Install a real Map-backed shim per test instead.
function installStorageShim(): void {
  const backing = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  };
}

function mkHunk(content: string[]) {
  return {
    header: `@@ -1,${content.length} +1,${content.length} @@`,
    oldStart: 1,
    oldCount: content.length,
    newStart: 1,
    newCount: content.length,
    lines: content.map((c, i) => ({ type: 'add' as const, content: c, lineNumber: { new: i + 1 } })),
  };
}

function mkFile(file: string, content: string[]): DiffFile {
  return { file, isNewFile: false, isDeleted: false, hunks: [mkHunk(content)] };
}

const FILES: DiffFile[] = [
  mkFile('src/auth.ts', ['const token = sign(user);']),
  mkFile('src/db.ts', ['await tx.commit();']),
];

function mkNarrative(over: Partial<NarrativeResponse> = {}): NarrativeResponse {
  return {
    title: 'T',
    tldr: 'Does a thing.',
    verdict: 'caution',
    readingPlan: [],
    concerns: [
      {
        question: 'What happens when the token expires mid-request?',
        file: 'src/auth.ts',
        line: 1,
        category: 'timing',
        why: 'w',
      },
    ],
    chapters: [
      {
        title: 'Auth',
        summary: 's',
        whyMatters: 'w',
        risk: 'high',
        sections: [{ type: 'diff', file: 'src/auth.ts', startLine: 1, endLine: 1, hunkIndex: 0 }],
      },
      {
        title: 'DB',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [{ type: 'diff', file: 'src/db.ts', startLine: 1, endLine: 1, hunkIndex: 0 }],
      },
    ],
    ...over,
  };
}

function mkPR(over: Partial<PRData> = {}): PRData {
  return {
    number: 7,
    title: 'PR',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'me', avatarUrl: '' },
    branch: 'feat',
    base: 'main',
    labels: [],
    createdAt: '',
    updatedAt: '',
    additions: 0,
    deletions: 0,
    changedFiles: 2,
    commits: 1,
    headSha: 'sha-a',
    ...over,
  };
}

beforeEach(() => {
  installStorageShim();
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
  });
});

describe('finding identity', () => {
  it('is content-addressed: stable across concern reordering and line shifts', () => {
    const a = buildWalkthrough(mkNarrative(), FILES);
    const shifted = mkNarrative({
      concerns: [
        { question: 'Unrelated new question about the db?', file: 'src/db.ts', line: 9, category: 'state', why: 'w' },
        // Same question, same file — but a different line and a different array position.
        {
          question: 'What happens when the token expires mid-request?',
          file: 'src/auth.ts',
          line: 42,
          category: 'timing',
          why: 'w',
        },
      ],
    });
    const b = buildWalkthrough(shifted, FILES);

    const idA = a.beats[0]!.resolve[0]!.id;
    const idB = b.beats[0]!.resolve.find((r) => r.question.includes('token expires'))!.id;
    expect(idA).toBe(idB);
  });

  it('differs by file for the same question, and normalizes punctuation/case', () => {
    expect(findingKey('src/a.ts', 'Is this safe?')).not.toBe(findingKey('src/b.ts', 'Is this safe?'));
    expect(findingKey('src/a.ts', 'Is this safe?')).toBe(findingKey('a/src/a.ts', 'is this SAFE'));
  });

  it('suffixes exact duplicates within one narrative so ids stay unique', () => {
    const dupe = mkNarrative({
      concerns: [
        { question: 'Same question?', file: 'src/auth.ts', line: 1, category: 'logic', why: 'w' },
        { question: 'Same question?', file: 'src/auth.ts', line: 5, category: 'logic', why: 'w' },
      ],
    });
    const ids = buildWalkthrough(dupe, FILES).beats[0]!.resolve.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).toBe(`${ids[0]}~2`);
  });
});

describe('resolved persistence', () => {
  it('survives a reload: setData restores what setResolved persisted', () => {
    const store = useReviewStore.getState();
    store.setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');
    const id = buildWalkthrough(mkNarrative(), FILES).beats[0]!.resolve[0]!.id;
    useReviewStore.getState().setResolved(id, true);

    // Simulate a fresh page load: wipe in-memory state, then setData again.
    useReviewStore.setState({ resolved: {}, reviewKey: null });
    useReviewStore.getState().setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');

    expect(useReviewStore.getState().resolved[id]).toBe(true);
  });

  it('survives applyPlan (regeneration) instead of being wiped', () => {
    const store = useReviewStore.getState();
    store.setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');
    const id = buildWalkthrough(mkNarrative(), FILES).beats[0]!.resolve[0]!.id;
    useReviewStore.getState().setResolved(id, true);

    const plan: Plan = {
      schemaVersion: 1,
      prTitle: 'T',
      prTldr: 't',
      prVerdict: 'caution',
      themes: [{ id: 'theme-0', title: 'Auth', riskLevel: 'high', rationale: 'r', hunkRefs: [] }],
      readingPlan: [],
      concerns: mkNarrative().concerns,
      missing: [],
    };
    useReviewStore.getState().applyPlan(plan);

    expect(useReviewStore.getState().resolved[id]).toBe(true);
  });

  it('is scoped per repo+PR and only persists true entries', () => {
    const store = useReviewStore.getState();
    store.setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');
    useReviewStore.getState().setResolved('id-1', true);
    useReviewStore.getState().setResolved('id-2', true);
    useReviewStore.getState().setResolved('id-2', false);

    expect(loadResolved('o/r#7')).toEqual({ 'id-1': true });
    expect(loadResolved('other/repo#7')).toEqual({});
  });
});

describe('reviewed-state identity', () => {
  it('follows chapter content across reordering, not array position', () => {
    const store = useReviewStore.getState();
    store.setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');
    useReviewStore.getState().toggleReviewed(0); // "Auth" chapter, currently index 0

    // Regenerated narrative: same two chapters, order flipped.
    const flipped = mkNarrative();
    flipped.chapters = [flipped.chapters[1]!, flipped.chapters[0]!];
    useReviewStore.getState().setData(mkPR(), flipped, FILES, [], 'https://github.com/o/r');

    const states = useReviewStore.getState().chapterStates;
    expect(states['ch-1']).toBe('reviewed'); // Auth moved to index 1 and stayed reviewed
    expect(states['ch-0']).toBe('reading');
  });

  it('resets when the chapter content changes', () => {
    const store = useReviewStore.getState();
    store.setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');
    useReviewStore.getState().toggleReviewed(0);

    const changedFiles = [mkFile('src/auth.ts', ['const token = sign(user, { exp });']), FILES[1]!];
    useReviewStore
      .getState()
      .setData(mkPR({ headSha: 'sha-b' }), mkNarrative(), changedFiles, [], 'https://github.com/o/r');

    expect(useReviewStore.getState().chapterStates['ch-0']).toBe('reading');
  });

  it('chapterContentKey ignores section order but tracks hunk content', () => {
    const ch = mkNarrative().chapters[0]!;
    const twoSections = {
      ...ch,
      sections: [
        { type: 'diff' as const, file: 'src/auth.ts', startLine: 1, endLine: 1, hunkIndex: 0 },
        { type: 'diff' as const, file: 'src/db.ts', startLine: 1, endLine: 1, hunkIndex: 0 },
      ],
    };
    const reversed = { ...twoSections, sections: [...twoSections.sections].reverse() };
    expect(chapterContentKey(twoSections, FILES)).toBe(chapterContentKey(reversed, FILES));

    const editedFiles = [mkFile('src/auth.ts', ['something else entirely']), FILES[1]!];
    expect(chapterContentKey(twoSections, FILES)).not.toBe(chapterContentKey(twoSections, editedFiles));
  });

  it('applyChapter restores persisted reviewed-state once real hunks land', () => {
    const store = useReviewStore.getState();
    store.setData(mkPR(), mkNarrative(), FILES, [], 'https://github.com/o/r');
    useReviewStore.getState().toggleReviewed(0);

    // Regeneration: plan arrives (placeholders, all 'reading'), then the writer chapter lands
    // with the same hunks — reviewed-state must come back for exactly that chapter.
    const plan: Plan = {
      schemaVersion: 1,
      prTitle: 'T',
      prTldr: 't',
      prVerdict: 'caution',
      themes: [
        { id: 'theme-0', title: 'Auth', riskLevel: 'high', rationale: 'r', hunkRefs: [] },
        { id: 'theme-1', title: 'DB', riskLevel: 'low', rationale: 'r', hunkRefs: [] },
      ],
      readingPlan: [],
      concerns: [],
      missing: [],
    };
    useReviewStore.getState().applyPlan(plan);
    expect(useReviewStore.getState().chapterStates['ch-0']).toBe('reading');

    useReviewStore.getState().applyChapter(0, mkNarrative().chapters[0]!, 'theme-0');
    expect(useReviewStore.getState().chapterStates['ch-0']).toBe('reviewed');
    expect(useReviewStore.getState().chapterStates['ch-1']).toBe('reading');
  });
});
