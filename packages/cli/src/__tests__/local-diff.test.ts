import { describe, expect, it } from 'vitest';
import { buildReviewFromDiff, CleanTreeError } from '../local/diff-source';
import { parseRemoteUrl } from '../local/identity';

const META = { branch: 'feature/x', headSha: 'abc123', baseRef: 'main', createdAt: '2026-06-15T00:00:00.000Z' };

const DIFF = `diff --git a/src/math.ts b/src/math.ts
index e69de29..0000000 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,4 @@
 export function add(a: number, b: number) {
-  return a + b;
+  return a + b + 0;
+  // extra
 }
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

describe('buildReviewFromDiff', () => {
  it('parses files and counts additions/deletions into synthesized metadata', () => {
    const review = buildReviewFromDiff(DIFF, META);
    expect(review.files.map((f) => f.file)).toEqual(['src/math.ts', 'src/new.ts']);
    expect(review.files.find((f) => f.file === 'src/new.ts')?.isNewFile).toBe(true);
    expect(review.metadata).toMatchObject({
      number: 0,
      title: 'feature/x',
      branch: 'feature/x',
      base: 'main',
      headSha: 'abc123',
      additions: 4, // 3 added lines + 2 in new file = 5? counted below
    });
    // 3 adds in math.ts (return..+0, // extra) = 2, plus 2 in new.ts = 4; 1 deletion
    expect(review.metadata.additions).toBe(4);
    expect(review.metadata.deletions).toBe(1);
    expect(review.metadata.changedFiles).toBe(2);
  });

  it('produces a stable content key that changes with the diff', () => {
    const a = buildReviewFromDiff(DIFF, META);
    const b = buildReviewFromDiff(DIFF, META);
    const c = buildReviewFromDiff(DIFF + '\n+// more', META);
    expect(a.contentKey).toBe(b.contentKey);
    expect(a.contentKey).not.toBe(c.contentKey);
    expect(a.contentKey).toHaveLength(12);
  });

  it('throws CleanTreeError on an empty or whitespace diff', () => {
    expect(() => buildReviewFromDiff('', META)).toThrow(CleanTreeError);
    expect(() => buildReviewFromDiff('   \n  ', META)).toThrow(CleanTreeError);
  });
});

describe('parseRemoteUrl', () => {
  it('parses ssh and https GitHub remotes', () => {
    expect(parseRemoteUrl('git@github.com:nicknisi/diffappointment.git')).toEqual({
      owner: 'nicknisi',
      repo: 'diffappointment',
    });
    expect(parseRemoteUrl('https://github.com/nicknisi/diffappointment')).toEqual({
      owner: 'nicknisi',
      repo: 'diffappointment',
    });
  });

  it('returns null for non-GitHub remotes', () => {
    expect(parseRemoteUrl('git@gitlab.com:foo/bar.git')).toBeNull();
    expect(parseRemoteUrl('not a url')).toBeNull();
  });
});
