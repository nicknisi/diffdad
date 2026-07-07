import { describe, expect, it } from 'vitest';
import { classifyCommand, formatConfigPointer, parsePrArg } from '../cli';

describe('classifyCommand', () => {
  it('recognizes daemon as a subcommand', () => {
    expect(classifyCommand('daemon')).toBe('daemon');
  });

  it('keeps existing subcommands and treats unknown tokens as PR shorthands', () => {
    expect(classifyCommand('review')).toBe('review');
    expect(classifyCommand('config')).toBe('config');
    expect(classifyCommand('cache')).toBe('cache');
    expect(classifyCommand('owner/repo#1')).toBe('pr-shorthand');
    expect(classifyCommand('139')).toBe('pr-shorthand');
    expect(classifyCommand(undefined)).toBe('pr-shorthand');
  });

  it('classifies `config` regardless of subcommand (show/reset route to the same stub)', () => {
    // The subcommand token is the second positional; classifyCommand only sees `config`, so
    // `config`, `config show`, and `config reset` all dispatch to the one pointer stub.
    expect(classifyCommand('config')).toBe('config');
  });
});

describe('formatConfigPointer', () => {
  const base = { url: 'http://localhost:4319/settings', configPath: '/home/dad/.config/diffdad/config.json' };

  it('includes the settings URL and config path when the daemon is up', () => {
    const out = formatConfigPointer({ ...base, daemonUp: true });
    expect(out).toContain('/settings');
    expect(out).toContain(base.configPath);
    expect(out).toContain('opening');
  });

  it('includes the settings URL and config path when the daemon is down', () => {
    const out = formatConfigPointer({ ...base, daemonUp: false });
    expect(out).toContain('/settings');
    expect(out).toContain(base.configPath);
  });

  it('names `dad daemon` and omits the opening copy when the daemon is down', () => {
    const out = formatConfigPointer({ ...base, daemonUp: false });
    expect(out).toContain('dad daemon');
    expect(out).not.toContain('opening');
  });
});

describe('parsePrArg', () => {
  describe('full GitHub URLs', () => {
    it('parses a https URL', () => {
      expect(parsePrArg('https://github.com/octocat/hello/pull/42')).toEqual({
        owner: 'octocat',
        repo: 'hello',
        number: 42,
      });
    });

    it('parses an http URL (case-insensitive)', () => {
      expect(parsePrArg('HTTP://github.com/Octocat/Hello/PULL/7')).toEqual({
        owner: 'Octocat',
        repo: 'Hello',
        number: 7,
      });
    });

    it('tolerates a trailing slash, query string, or fragment', () => {
      expect(parsePrArg('https://github.com/o/r/pull/1/files')).toEqual({ owner: 'o', repo: 'r', number: 1 });
      expect(parsePrArg('https://github.com/o/r/pull/1?diff=split')).toEqual({ owner: 'o', repo: 'r', number: 1 });
      expect(parsePrArg('https://github.com/o/r/pull/1#discussion')).toEqual({ owner: 'o', repo: 'r', number: 1 });
    });

    it('returns null for non-PR github URLs', () => {
      expect(parsePrArg('https://github.com/o/r/issues/1')).toBeNull();
      expect(parsePrArg('https://github.com/o/r')).toBeNull();
    });
  });

  describe('owner/repo#N shorthand', () => {
    it('parses the shorthand', () => {
      expect(parsePrArg('octocat/hello#42')).toEqual({
        owner: 'octocat',
        repo: 'hello',
        number: 42,
      });
    });

    it('rejects extra slashes', () => {
      expect(parsePrArg('octocat/sub/hello#42')).toBeNull();
    });

    it('rejects whitespace inside owner/repo', () => {
      expect(parsePrArg('octo cat/hello#42')).toBeNull();
    });
  });

  describe('bare numbers and bad input', () => {
    it('returns null on a bare number (caller resolves via git remote)', () => {
      expect(parsePrArg('139')).toBeNull();
    });

    it('returns null on empty / whitespace input', () => {
      expect(parsePrArg('')).toBeNull();
      expect(parsePrArg('   ')).toBeNull();
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(parsePrArg('  octocat/hello#42  ')).toEqual({
        owner: 'octocat',
        repo: 'hello',
        number: 42,
      });
    });

    it('returns null for unrelated strings', () => {
      expect(parsePrArg('not-a-pr')).toBeNull();
      expect(parsePrArg('https://gitlab.com/o/r/-/merge_requests/1')).toBeNull();
    });
  });
});
