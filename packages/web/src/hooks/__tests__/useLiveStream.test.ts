import { describe, expect, it, beforeEach } from 'vitest';
import { handleNarrativePartialEvent } from '../useLiveStream';
import { useReviewStore } from '../../state/review-store';
import type { NarrativeResponse, PRData } from '../../state/types';

function mkPr(): PRData {
  return {
    number: 1,
    title: 'test',
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
    changedFiles: 0,
    commits: 1,
    headSha: 'abc1234',
  };
}

function mkNarrative(title = 'streamed'): NarrativeResponse {
  return {
    title,
    tldr: 'an in-flight narrative',
    verdict: 'safe',
    readingPlan: [],
    concerns: [],
    chapters: [{ title: 'Ch1', summary: 's', whyMatters: 'w', risk: 'low', sections: [] }],
  };
}

function mkMessageEvent(data: unknown): MessageEvent {
  return { data: JSON.stringify(data) } as MessageEvent;
}

describe('handleNarrativePartialEvent', () => {
  beforeEach(() => {
    useReviewStore.setState({
      pr: null,
      narrative: null,
      activeChapterId: null,
      chapterStates: {},
      lastEventAt: 0,
    });
  });

  it('applies partial narrative payloads to the store', () => {
    const before = useReviewStore.getState().lastEventAt;
    handleNarrativePartialEvent(mkMessageEvent({ pr: mkPr(), narrative: mkNarrative('streamed-title') }));
    const after = useReviewStore.getState();
    expect(after.narrative?.title).toBe('streamed-title');
    expect(after.pr?.number).toBe(1);
    expect(after.activeChapterId).toBe('ch-0');
    expect(after.lastEventAt).toBeGreaterThan(before);
  });

  it('ignores malformed JSON without throwing', () => {
    const before = useReviewStore.getState();
    expect(() => handleNarrativePartialEvent({ data: '{ not json' } as MessageEvent)).not.toThrow();
    const after = useReviewStore.getState();
    expect(after.narrative).toBe(before.narrative);
    expect(after.lastEventAt).toBe(before.lastEventAt);
  });

  it('preserves user-set chapter states across partial updates', () => {
    handleNarrativePartialEvent(mkMessageEvent({ pr: mkPr(), narrative: mkNarrative() }));
    useReviewStore.setState({ chapterStates: { 'ch-0': 'reviewed' } });
    handleNarrativePartialEvent(mkMessageEvent({ pr: mkPr(), narrative: mkNarrative('updated') }));
    expect(useReviewStore.getState().chapterStates['ch-0']).toBe('reviewed');
    expect(useReviewStore.getState().narrative?.title).toBe('updated');
  });
});
