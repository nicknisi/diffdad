import { useReviewStore } from '../state/review-store';
import { cycleTheme } from '../lib/theme';
import { IconMonitor, IconMoon, IconSun } from './Icons';

/**
 * The light → dark → auto theme toggle. Self-contained (reads theme + setTheme from the store) so
 * every surface — the PR AppBar, the command center, the per-unit drill-in — shares one control
 * instead of triplicating the markup. Without this on the daemon surfaces there was no way to leave
 * the `auto` default, which on a dark OS stranded the command center in dark mode.
 */
export function ThemeToggle() {
  const theme = useReviewStore((s) => s.theme);
  const setTheme = useReviewStore((s) => s.setTheme);

  return (
    <button
      type="button"
      aria-label={`Theme: ${theme}`}
      title={`Theme: ${theme}`}
      onClick={() => setTheme(cycleTheme(theme))}
      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[var(--bg-panel)] text-[var(--fg-2)] hover:bg-[var(--gray-2)] hover:text-[var(--fg-1)]"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      {theme === 'light' ? (
        <IconSun className="h-[15px] w-[15px]" />
      ) : theme === 'dark' ? (
        <IconMoon className="h-[15px] w-[15px]" />
      ) : (
        <IconMonitor className="h-[15px] w-[15px]" />
      )}
    </button>
  );
}
