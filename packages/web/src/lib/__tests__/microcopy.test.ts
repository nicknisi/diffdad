import { describe, expect, it } from 'vitest';
import { copy } from '../microcopy';

describe('copy.refreshResult', () => {
  it('is caught-up when a pass found and cleared nothing', () => {
    expect(copy.refreshResult(0, 0, 0)).toBe("Nothing new. You're all caught up.");
  });

  it('reports minted-only', () => {
    expect(copy.refreshResult(1, 0, 0)).toBe('1 new.');
    expect(copy.refreshResult(3, 0, 0)).toBe('3 new.');
  });

  it('reports resurfaced-only', () => {
    expect(copy.refreshResult(0, 2, 0)).toBe('2 back for another look.');
  });

  it('reports removed-only as a caught-up cleanup line', () => {
    expect(copy.refreshResult(0, 0, 1)).toBe('Nothing new. 1 cleared out.');
    expect(copy.refreshResult(0, 0, 3)).toBe('Nothing new. 3 cleared out.');
  });

  it('folds removed into a sentence led by incoming work', () => {
    expect(copy.refreshResult(2, 0, 3)).toBe('2 new, 3 cleared out.');
    expect(copy.refreshResult(0, 1, 2)).toBe('1 back for another look, 2 cleared out.');
  });

  it('combines all three counts', () => {
    expect(copy.refreshResult(2, 1, 3)).toBe('2 new, 1 back for another look, 3 cleared out.');
  });
});

describe('github-off copy', () => {
  it('names both remedies and the restart in the banner', () => {
    expect(copy.githubOffBanner).toContain('gh auth login');
    expect(copy.githubOffBanner).toContain('DIFFDAD_GITHUB_TOKEN');
    expect(copy.githubOffBanner).toContain('dad daemon install');
  });

  it('keeps the chip label short', () => {
    expect(copy.githubOff).toBe('GitHub off');
  });
});
