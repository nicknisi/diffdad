import { describe, expect, it } from 'vitest';
import { parseCommitArg, parsePrArg } from '../cli';

// ---------------------------------------------------------------------------
// parsePrArg
// ---------------------------------------------------------------------------

describe('parsePrArg', () => {
  it('parses a full GitHub PR URL', () => {
    const result = parsePrArg('https://github.com/owner/repo/pull/123');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', number: 123 });
  });

  it('parses owner/repo#number shorthand', () => {
    const result = parsePrArg('owner/repo#123');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', number: 123 });
  });

  it('rejects a bare PR number (caller handles it)', () => {
    expect(parsePrArg('139')).toBeNull();
  });

  it('rejects a bare hex string (not a PR form)', () => {
    expect(parsePrArg('cafe')).toBeNull();
    expect(parsePrArg('abcd1234')).toBeNull();
  });

  it('rejects owner/repo#<hex-non-decimal> (not a valid PR number)', () => {
    // "cafe" is hex but not purely decimal — parsePrArg requires \d+ after #
    expect(parsePrArg('owner/repo#cafe')).toBeNull();
    expect(parsePrArg('owner/repo#1a2b')).toBeNull();
  });

  it('rejects a commit URL', () => {
    expect(parsePrArg('https://github.com/owner/repo/commit/abc1234')).toBeNull();
  });

  it('parses a PR URL with trailing query/fragment', () => {
    const result = parsePrArg('https://github.com/owner/repo/pull/42?diff=split#files');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', number: 42 });
  });
});

// ---------------------------------------------------------------------------
// parseCommitArg
// ---------------------------------------------------------------------------

describe('parseCommitArg', () => {
  it('parses a full GitHub commit URL', () => {
    const result = parseCommitArg('https://github.com/owner/repo/commit/abc1234');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', sha: 'abc1234' });
  });

  it('parses owner/repo@sha shorthand', () => {
    const result = parseCommitArg('owner/repo@abc1234');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', sha: 'abc1234' });
  });

  it('parses owner/repo#<hex-non-decimal> as a commit SHA', () => {
    // "#" separator is accepted when the token after it has non-decimal hex chars
    const result = parseCommitArg('owner/repo#cafe');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', sha: 'cafe' });
  });

  it('does NOT parse a bare SHA (bare SHAs handled separately in commitCommand)', () => {
    // parseCommitArg itself never accepts bare SHAs — commitCommand handles them
    expect(parseCommitArg('cafe1234')).toBeNull();
    expect(parseCommitArg('abcd')).toBeNull();
  });

  it('does NOT parse owner/repo#<purely-decimal> as a commit (guard against stealing PR refs)', () => {
    // "1234" is valid hex but is all-decimal — the !/^\d+$/ guard rejects it
    expect(parseCommitArg('owner/repo#1234')).toBeNull();
    expect(parseCommitArg('owner/repo#99')).toBeNull();
  });

  it('does NOT parse a full PR URL', () => {
    expect(parseCommitArg('https://github.com/owner/repo/pull/123')).toBeNull();
  });

  it('accepts the minimum 4-char SHA in structured forms', () => {
    expect(parseCommitArg('owner/repo@cafe')).toEqual({ owner: 'owner', repo: 'repo', sha: 'cafe' });
    expect(parseCommitArg('owner/repo@abc')).toBeNull(); // 3 chars — too short
  });

  it('accepts a full 40-char SHA', () => {
    const sha = 'a'.repeat(40);
    expect(parseCommitArg(`owner/repo@${sha}`)).toEqual({ owner: 'owner', repo: 'repo', sha });
  });

  it('rejects a SHA that exceeds 40 chars', () => {
    const sha = 'a'.repeat(41);
    expect(parseCommitArg(`owner/repo@${sha}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary: PR number forms that are also valid hex (no misrouting)
// ---------------------------------------------------------------------------

describe('hex/decimal boundary — no cross-routing', () => {
  it('owner/repo#1234 is a PR reference, not a commit (parsePrArg wins)', () => {
    // parsePrArg matches first in reviewCommand
    expect(parsePrArg('owner/repo#1234')).toEqual({ owner: 'owner', repo: 'repo', number: 1234 });
    // parseCommitArg rejects it — the !/^\d+$/ guard triggers
    expect(parseCommitArg('owner/repo#1234')).toBeNull();
  });

  it('owner/repo#0 is treated as a PR reference, not a commit', () => {
    expect(parsePrArg('owner/repo#0')).toEqual({ owner: 'owner', repo: 'repo', number: 0 });
    expect(parseCommitArg('owner/repo#0')).toBeNull();
  });

  it('purely-numeric strings with 4+ chars are never parsed as commits by parseCommitArg', () => {
    // All-digit values (even if valid hex) must not be silently treated as SHAs
    for (const str of ['1234', '10000', '99999', '0000']) {
      expect(parseCommitArg(`owner/repo#${str}`)).toBeNull();
      expect(parseCommitArg(`owner/repo@${str}`)).toBeNull();
    }
  });
});
