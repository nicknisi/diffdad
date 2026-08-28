import { describe, expect, test } from 'bun:test';
import type { PRComment, PRReview } from '../github/types';
import { deriveReviewRound } from '../review-round';

const AUTHOR = 'prauthor';
const REVIEWER = 'reviewer';

function comment(over: Partial<PRComment> & Pick<PRComment, 'id' | 'author' | 'createdAt'>): PRComment {
  return {
    body: 'x',
    updatedAt: over.createdAt,
    path: 'src/a.ts',
    line: 10,
    ...over,
  };
}

function review(over: Partial<PRReview> & Pick<PRReview, 'id' | 'state' | 'submittedAt'>): PRReview {
  return {
    user: REVIEWER,
    avatarUrl: '',
    ...over,
  };
}

describe('deriveReviewRound state', () => {
  test('awaiting-review when there are no reviews', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('awaiting-review');
    expect(round.lastReviewSubmittedAt).toBeUndefined();
  });

  test('changes-requested when latest CHANGES_REQUESTED is newer than any APPROVED', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [],
      reviews: [
        review({ id: 1, state: 'APPROVED', submittedAt: '2024-01-01T00:00:00Z' }),
        review({ id: 2, state: 'CHANGES_REQUESTED', submittedAt: '2024-01-02T00:00:00Z' }),
      ],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('changes-requested');
    expect(round.lastReviewSubmittedAt).toBe('2024-01-02T00:00:00Z');
  });

  test('an APPROVED newer than CHANGES_REQUESTED is not changes-requested', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [],
      reviews: [
        review({ id: 1, state: 'CHANGES_REQUESTED', submittedAt: '2024-01-01T00:00:00Z' }),
        review({ id: 2, state: 'APPROVED', submittedAt: '2024-01-02T00:00:00Z' }),
      ],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('awaiting-review');
  });

  test('DISMISSED CHANGES_REQUESTED is ignored', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [],
      reviews: [review({ id: 1, state: 'DISMISSED', submittedAt: '2024-01-02T00:00:00Z' })],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('awaiting-review');
  });

  test('updated-since-review when a commit lands after the newest review', () => {
    const round = deriveReviewRound({
      headSha: 'b',
      lastNarratedSha: 'a',
      comments: [],
      reviews: [review({ id: 1, state: 'APPROVED', submittedAt: '2024-01-01T00:00:00Z' })],
      commits: [{ sha: 'b', committedAt: '2024-01-02T00:00:00Z' }],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('updated-since-review');
  });

  test('updated-since-review takes precedence over changes-requested (D1)', () => {
    const round = deriveReviewRound({
      headSha: 'b',
      lastNarratedSha: 'a',
      comments: [],
      reviews: [review({ id: 1, state: 'CHANGES_REQUESTED', submittedAt: '2024-01-01T00:00:00Z' })],
      commits: [{ sha: 'b', committedAt: '2024-01-03T00:00:00Z' }],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('updated-since-review');
  });

  test('a commit before the review does not trigger updated-since-review', () => {
    const round = deriveReviewRound({
      headSha: 'b',
      lastNarratedSha: 'b',
      comments: [],
      reviews: [review({ id: 1, state: 'CHANGES_REQUESTED', submittedAt: '2024-01-05T00:00:00Z' })],
      commits: [{ sha: 'b', committedAt: '2024-01-01T00:00:00Z' }],
      prAuthor: AUTHOR,
    });
    expect(round.state).toBe('changes-requested');
  });
});

describe('answered-thread heuristic', () => {
  test('a reviewer comment with no reply is unresolved', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z' })],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.unresolvedThreads).toBe(1);
  });

  test('a thread whose last reply is by the PR author is answered', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [
        comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z' }),
        comment({ id: 2, author: AUTHOR, createdAt: '2024-01-02T00:00:00Z', inReplyToId: 1 }),
      ],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.unresolvedThreads).toBe(0);
  });

  test('a reviewer getting the last word keeps the thread unresolved', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [
        comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z' }),
        comment({ id: 2, author: AUTHOR, createdAt: '2024-01-02T00:00:00Z', inReplyToId: 1 }),
        comment({ id: 3, author: REVIEWER, createdAt: '2024-01-03T00:00:00Z', inReplyToId: 1 }),
      ],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.unresolvedThreads).toBe(1);
  });

  test('PR-level (non-inline) comments are not counted as threads', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [
        comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z', path: undefined, line: undefined }),
      ],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.unresolvedThreads).toBe(0);
  });
});

describe('carriedOverThreads', () => {
  test('is zero when head has not moved past the narrated SHA', () => {
    const round = deriveReviewRound({
      headSha: 'a',
      lastNarratedSha: 'a',
      comments: [comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z' })],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.carriedOverThreads).toBe(0);
  });

  test('counts unresolved threads predating the latest push once head advanced', () => {
    const round = deriveReviewRound({
      headSha: 'b',
      lastNarratedSha: 'a',
      comments: [
        // Unresolved, created before the push -> carries over.
        comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z' }),
        // Answered -> not carried over.
        comment({ id: 2, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z', path: 'src/b.ts' }),
        comment({ id: 3, author: AUTHOR, createdAt: '2024-01-01T12:00:00Z', inReplyToId: 2 }),
        // Unresolved, created AFTER the push -> not carried over.
        comment({ id: 4, author: REVIEWER, createdAt: '2024-01-05T00:00:00Z', path: 'src/c.ts' }),
      ],
      reviews: [],
      commits: [{ sha: 'b', committedAt: '2024-01-03T00:00:00Z' }],
      prAuthor: AUTHOR,
    });
    expect(round.unresolvedThreads).toBe(2);
    expect(round.carriedOverThreads).toBe(1);
  });

  test('without commit timestamps every unresolved thread is treated as carried over', () => {
    const round = deriveReviewRound({
      headSha: 'b',
      lastNarratedSha: 'a',
      comments: [
        comment({ id: 1, author: REVIEWER, createdAt: '2024-01-01T00:00:00Z' }),
        comment({ id: 2, author: REVIEWER, createdAt: '2024-01-02T00:00:00Z', path: 'src/b.ts' }),
      ],
      reviews: [],
      prAuthor: AUTHOR,
    });
    expect(round.carriedOverThreads).toBe(2);
  });
});
