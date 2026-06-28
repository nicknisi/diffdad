import { describe, expect, it, beforeEach } from 'vitest';
import { handleAgentCommentEvent, handleNarrativePartialEvent, handleUnitCommentEvent } from '../useLiveStream';
import { useReviewStore } from '../../state/review-store';
import type { AgentComment, NarrativeResponse, PRComment, PRData } from '../../state/types';

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

function mkComment(id: number): PRComment {
  return { id, author: 'octocat', body: 'live comment', createdAt: 'now', updatedAt: 'now' };
}

describe('handleUnitCommentEvent', () => {
  beforeEach(() => {
    useReviewStore.setState({ mode: 'command-center', route: { name: 'unit', unitId: 'u_1' }, comments: [] });
  });

  it('appends a comment to the store when it targets the open unit', () => {
    handleUnitCommentEvent(mkMessageEvent({ unitId: 'u_1', comment: mkComment(7) }));
    expect(useReviewStore.getState().comments.map((c) => c.id)).toEqual([7]);
  });

  it('ignores a comment for a different unit (no cross-unit leak)', () => {
    handleUnitCommentEvent(mkMessageEvent({ unitId: 'u_2', comment: mkComment(9) }));
    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it('ignores comments when not drilled into a unit', () => {
    useReviewStore.setState({ route: { name: 'center' } });
    handleUnitCommentEvent(mkMessageEvent({ unitId: 'u_1', comment: mkComment(7) }));
    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it('dedupes by id', () => {
    useReviewStore.setState({ comments: [mkComment(7)] });
    handleUnitCommentEvent(mkMessageEvent({ unitId: 'u_1', comment: mkComment(7) }));
    expect(useReviewStore.getState().comments).toHaveLength(1);
  });

  it('ignores malformed JSON without throwing', () => {
    expect(() => handleUnitCommentEvent({ data: '{ not json' } as MessageEvent)).not.toThrow();
    expect(useReviewStore.getState().comments).toEqual([]);
  });
});

function mkAgentComment(id: string): AgentComment {
  return {
    id,
    path: 'a.ts',
    line: 1,
    side: 'RIGHT',
    body: 'beat',
    status: 'open',
    author: 'user',
    replies: [],
    hunkContext: '',
    createdAt: 'now',
  };
}

describe('handleAgentCommentEvent', () => {
  beforeEach(() => {
    useReviewStore.setState({ mode: 'command-center', route: { name: 'unit', unitId: 'u_1' }, agentComments: [] });
  });

  it('applies a unit-scoped payload to the open unit', () => {
    handleAgentCommentEvent(mkMessageEvent({ unitId: 'u_1', comments: [mkAgentComment('c1')] }));
    expect(useReviewStore.getState().agentComments.map((c) => c.id)).toEqual(['c1']);
  });

  it('ignores a unit-scoped payload for a different unit (no cross-unit leak)', () => {
    handleAgentCommentEvent(mkMessageEvent({ unitId: 'u_2', comments: [mkAgentComment('c2')] }));
    expect(useReviewStore.getState().agentComments).toEqual([]);
  });

  it('ignores malformed JSON without throwing', () => {
    expect(() => handleAgentCommentEvent({ data: '{ not json' } as MessageEvent)).not.toThrow();
    expect(useReviewStore.getState().agentComments).toEqual([]);
  });
});
