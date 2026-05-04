import { describe, expect, it } from 'vitest';
import { tryParsePartialJson } from '../narrative/engine';

describe('tryParsePartialJson', () => {
  it('parses complete JSON', () => {
    expect(tryParsePartialJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null when no opening brace seen yet', () => {
    expect(tryParsePartialJson('hello world')).toBeNull();
  });

  it('closes a partial object mid-key-string', () => {
    const partial = '{"title":"hello world","tld';
    const parsed = tryParsePartialJson(partial);
    expect(parsed).not.toBeNull();
    expect((parsed as { title: string }).title).toBe('hello world');
  });

  it('closes a partial object mid-value-string', () => {
    const partial = '{"title":"hello wor';
    const parsed = tryParsePartialJson(partial);
    expect(parsed).not.toBeNull();
    expect((parsed as { title: string }).title.startsWith('hello wor')).toBe(true);
  });

  it('handles partial arrays', () => {
    const partial = '{"chapters":[{"title":"one"},{"title":"tw';
    const parsed = tryParsePartialJson(partial) as { chapters: { title: string }[] };
    expect(parsed).not.toBeNull();
    expect(parsed.chapters.length).toBeGreaterThanOrEqual(1);
    expect(parsed.chapters[0]?.title).toBe('one');
  });

  it('handles escaped quotes correctly', () => {
    const partial = '{"x":"a \\"b';
    const parsed = tryParsePartialJson(partial) as { x: string };
    expect(parsed).not.toBeNull();
    expect(parsed.x.startsWith('a "b')).toBe(true);
  });

  it('handles nested objects', () => {
    const partial = '{"a":{"b":{"c":';
    const parsed = tryParsePartialJson(partial);
    // Either returns a parse with truncated value, or fallback to last-safe.
    // Either way should not throw.
    expect(parsed).not.toThrow;
  });
});
