import { describe, expect, it } from 'vitest';
import { cycleTheme } from '../theme';

describe('cycleTheme', () => {
  it('cycles light → dark → auto → light', () => {
    expect(cycleTheme('light')).toBe('dark');
    expect(cycleTheme('dark')).toBe('auto');
    expect(cycleTheme('auto')).toBe('light');
  });
});
