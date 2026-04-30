import { useEffect, useState } from "react";
import { useReviewStore } from "./state/review-store";
import { useNarrative } from "./hooks/useNarrative";
import { useLiveStream } from "./hooks/useLiveStream";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ActivityDrawer } from "./components/ActivityDrawer";
import { AppBar } from "./components/AppBar";
import { ClassicView } from "./components/ClassicView";
import { PRHeader } from "./components/PRHeader";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { StoryView } from "./components/StoryView";
import { SubmitBar } from "./components/SubmitBar";
import { copy } from "./lib/microcopy";

export default function App() {
  const theme = useReviewStore((s) => s.theme);
  const view = useReviewStore((s) => s.view);
  const shortcutsHelpOpen = useReviewStore((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useReviewStore((s) => s.setShortcutsHelpOpen);
  const { loading, error } = useNarrative();
  useLiveStream();
  useKeyboardShortcuts();
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Escape closes the activity drawer when nothing else is open.
  useEffect(() => {
    if (!activityOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (shortcutsHelpOpen) return;
      e.preventDefault();
      setActivityOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activityOpen, shortcutsHelpOpen]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--fg-2)]">
        <p className="text-base">{copy.loading}</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--fg-2)]">
        <div className="text-center">
          <p className="text-base">{copy.errorGeneric}</p>
          <p className="mt-2 text-sm text-[var(--fg-3)]">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-20 text-[var(--fg-1)]">
      <AppBar onOpenActivity={() => setActivityOpen(true)} />
      <PRHeader />
      {view === "story" ? <StoryView /> : <ClassicView />}
      <SubmitBar />
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <ShortcutsHelp
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />
    </div>
  );
}
