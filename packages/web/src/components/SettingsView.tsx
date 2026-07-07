import { useCallback, useEffect, useState } from 'react';
import { getAccentMeta } from '../lib/accents';
import { fetchConfig } from '../lib/config-client';
import { useReviewStore } from '../state/review-store';
import { DadMark } from './DadMark';
import { AiSection } from './settings/AiSection';
import { DaemonSection } from './settings/DaemonSection';
import { DisplaySection } from './settings/DisplaySection';
import { GitHubSection } from './settings/GitHubSection';

/**
 * The settings page — one scrollable column of grouped sections, mounted two ways: command-center
 * mode reaches it via the `/settings` route, PR mode via the `settingsOpen` store flag (it has no URL
 * routing). Sections are mode-aware: the daemon poll-interval control renders only in command-center
 * mode, since a PR-mode process has no poller. All field values read from the store (seeded by
 * `GET /api/config` and kept live by the SSE `config` event).
 */
export function SettingsView() {
  const mode = useReviewStore((s) => s.mode);
  const accent = useReviewStore((s) => s.accent);
  const configLoaded = useReviewStore((s) => s.configLoaded);
  const navigate = useReviewStore((s) => s.navigate);
  const setSettingsOpen = useReviewStore((s) => s.setSettingsOpen);
  const applyConfigResponse = useReviewStore((s) => s.applyConfigResponse);
  const { markBg } = getAccentMeta(accent);

  const [retrying, setRetrying] = useState(false);

  const close = useCallback(() => {
    if (mode === 'command-center') navigate({ name: 'center' });
    else setSettingsOpen(false);
  }, [mode, navigate, setSettingsOpen]);

  // Escape closes the page (back to the center in command-center, or clears the PR-mode flag) —
  // mirrors the ShortcutsHelp overlay handling.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  async function retry() {
    setRetrying(true);
    try {
      applyConfigResponse(await fetchConfig());
    } catch {
      // stay on the banner; the user can retry again
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-24 text-[var(--fg-1)]">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 bg-[var(--bg-panel)] px-6 py-3"
        style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        <DadMark size={22} bg={markBg} shape="circle" showBadge={false} />
        <span className="text-[15px] font-bold tracking-tight">
          Diff Dad <span className="font-medium text-[var(--fg-3)]">· settings</span>
        </span>
        <button
          type="button"
          onClick={close}
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--fg-2)] transition-colors hover:text-[var(--fg-1)]"
        >
          <span aria-hidden>←</span> {mode === 'command-center' ? 'command center' : 'back to review'}
        </button>
      </header>

      <main className="mx-auto flex max-w-[680px] flex-col gap-5 px-6 pt-6">
        {!configLoaded && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-[13px]"
            style={{
              background: 'var(--amber-3)',
              color: 'var(--amber-11)',
              boxShadow: 'inset 0 0 0 1px var(--amber-9)',
            }}
          >
            <span>Couldn’t load your settings from the server. Showing defaults.</span>
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              className="shrink-0 rounded-md px-2.5 py-1 text-[12.5px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--amber-9)', color: 'var(--amber-1)' }}
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        <AiSection />
        <GitHubSection />
        <DisplaySection />
        {mode === 'command-center' && <DaemonSection />}
      </main>
    </div>
  );
}
