import type { NarrativeResponse, Concern, Callout, ReviewDelta, ScoredConcern, ScoredCallout } from './types';

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

function concernBucketKey(c: Concern): string {
  return `${normalizePath(c.file)}::${c.category}`;
}

function calloutBucketKey(c: Callout, chapterIndex: number): string {
  return `${chapterIndex}::${normalizePath(c.file)}::${c.level}`;
}

const LINE_FUZZ = 3;

export function diffConcerns(previous: NarrativeResponse, current: NarrativeResponse): ReviewDelta {
  const prevConcerns = previous.concerns ?? [];
  const currConcerns = current.concerns ?? [];

  const prevBuckets = new Map<string, { concern: Concern; consumed: boolean }[]>();
  for (const c of prevConcerns) {
    const key = concernBucketKey(c);
    const bucket = prevBuckets.get(key) ?? [];
    bucket.push({ concern: c, consumed: false });
    prevBuckets.set(key, bucket);
  }

  const scoredConcerns: ScoredConcern[] = [];

  for (const curr of currConcerns) {
    const key = concernBucketKey(curr);
    const bucket = prevBuckets.get(key);
    let matched = false;

    if (bucket) {
      for (const entry of bucket) {
        if (entry.consumed) continue;
        if (Math.abs(entry.concern.line - curr.line) <= LINE_FUZZ) {
          entry.consumed = true;
          matched = true;
          scoredConcerns.push({ ...curr, status: 'unfixed' });
          break;
        }
      }
    }

    if (!matched) {
      scoredConcerns.push({ ...curr, status: 'new' });
    }
  }

  for (const bucket of prevBuckets.values()) {
    for (const entry of bucket) {
      if (!entry.consumed) {
        scoredConcerns.push({ ...entry.concern, status: 'fixed' });
      }
    }
  }

  const prevChapters = previous.chapters ?? [];
  const currChapters = current.chapters ?? [];

  const prevCalloutBuckets = new Map<string, { callout: Callout; chapterIndex: number; consumed: boolean }[]>();
  for (let ci = 0; ci < prevChapters.length; ci++) {
    for (const callout of prevChapters[ci]!.callouts ?? []) {
      const key = calloutBucketKey(callout, ci);
      const bucket = prevCalloutBuckets.get(key) ?? [];
      bucket.push({ callout, chapterIndex: ci, consumed: false });
      prevCalloutBuckets.set(key, bucket);
    }
  }

  const scoredCallouts: ScoredCallout[] = [];

  for (let ci = 0; ci < currChapters.length; ci++) {
    for (const callout of currChapters[ci]!.callouts ?? []) {
      const key = calloutBucketKey(callout, ci);
      const bucket = prevCalloutBuckets.get(key);
      let matched = false;

      if (bucket) {
        for (const entry of bucket) {
          if (entry.consumed) continue;
          if (Math.abs(entry.callout.line - callout.line) <= LINE_FUZZ) {
            entry.consumed = true;
            matched = true;
            scoredCallouts.push({ ...callout, chapterIndex: ci, status: 'unfixed' });
            break;
          }
        }
      }

      if (!matched) {
        scoredCallouts.push({ ...callout, chapterIndex: ci, status: 'new' });
      }
    }
  }

  for (const bucket of prevCalloutBuckets.values()) {
    for (const entry of bucket) {
      if (!entry.consumed) {
        scoredCallouts.push({ ...entry.callout, chapterIndex: entry.chapterIndex, status: 'fixed' });
      }
    }
  }

  const summary = {
    fixed: scoredConcerns.filter((c) => c.status === 'fixed').length + scoredCallouts.filter((c) => c.status === 'fixed').length,
    unfixed: scoredConcerns.filter((c) => c.status === 'unfixed').length + scoredCallouts.filter((c) => c.status === 'unfixed').length,
    new: scoredConcerns.filter((c) => c.status === 'new').length + scoredCallouts.filter((c) => c.status === 'new').length,
  };

  return { concerns: scoredConcerns, callouts: scoredCallouts, summary };
}
