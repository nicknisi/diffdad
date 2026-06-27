export type Theme = 'light' | 'dark' | 'auto';

/** The theme-toggle order shown across every surface: light → dark → auto → light. */
export function cycleTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light';
}
