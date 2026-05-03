import { describe, expect, it } from 'vitest';
import { redactSecret } from '../config';

describe('redactSecret', () => {
  it('returns <empty> for an empty string', () => {
    expect(redactSecret('')).toBe('<empty>');
  });

  it('masks short secrets entirely', () => {
    expect(redactSecret('abc')).toBe('••••');
    expect(redactSecret('12345678')).toBe('••••');
  });

  it('keeps first and last 4 chars for long secrets', () => {
    const result = redactSecret('ghp_1234567890abcdef');
    expect(result).toContain('ghp_');
    expect(result).toContain('cdef');
    expect(result).toContain('20 chars');
    expect(result).not.toContain('567890');
  });
});
