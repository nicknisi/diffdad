import { useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { ActivityDrawer } from './ActivityDrawer';
import { AppBar } from './AppBar';
import { ClassicView } from './ClassicView';
import { ShortcutsHelp } from './ShortcutsHelp';
import { TriageStrip } from './TriageStrip';
import { WatchStatusBar } from './WatchStatusBar';

/**
 * Self-contained shell for `dad watch`. Composes only watch chrome — the diff, the
 * agent-comment loop, the status bar — and deliberately never imports SubmitBar, the
 * Story/Recap tabs, PRHeader, or the narrative. That structural boundary is what keeps
 * PR-review ceremony from leaking into watch mode; the leak was always reusing review's
 * shell, not the guards.
 */
export function WatchView() {
  const files = useReviewStore((s) => s.files);
  const shortcutsHelpOpen = useReviewStore((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useReviewStore((s) => s.setShortcutsHelpOpen);
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-20 text-[var(--fg-1)]">
      <AppBar onOpenActivity={() => setActivityOpen(true)} />
      <WatchStatusBar />
      <TriageStrip />
      {files.length === 0 ? (
        <div className="mx-auto max-w-[1100px] px-6 pt-24 text-center">
          <p className="text-[15px] font-medium text-[var(--fg-2)]">No changes yet — watching your working tree…</p>
          <p className="mt-1.5 text-[13px] text-[var(--fg-3)]">
            Edit a file or let your agent run, and the diff shows up here. Click a line — or drag a range — to leave a
            note for the agent.
          </p>
        </div>
      ) : (
        <ClassicView />
      )}
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <ShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
    </div>
  );
}
