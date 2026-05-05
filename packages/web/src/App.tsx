import { useEffect, useState } from 'react';
import { useReviewStore } from './state/review-store';
import { useNarrative } from './hooks/useNarrative';
import { useLiveStream } from './hooks/useLiveStream';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ActivityDrawer } from './components/ActivityDrawer';
import { AppBar } from './components/AppBar';
import { ClassicView } from './components/ClassicView';
import { GeneratingScreen } from './components/GeneratingScreen';
import { PRHeader } from './components/PRHeader';
import { RecapView } from './components/RecapView';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { StoryView } from './components/StoryView';
import { SubmitBar } from './components/SubmitBar';
import { copy } from './lib/microcopy';
import { getAccentMeta } from './lib/accents';
import { renderDadMarkSVG } from './components/DadMark';

export default function App() {
  const theme = useReviewStore((s) => s.theme);
  const accent = useReviewStore((s) => s.accent);
  const view = useReviewStore((s) => s.view);
  const pr = useReviewStore((s) => s.pr);
  const narrative = useReviewStore((s) => s.narrative);
  const shortcutsHelpOpen = useReviewStore((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useReviewStore((s) => s.setShortcutsHelpOpen);
  const { loading, generating, setGenerating, error } = useNarrative();

  useEffect(() => {
    if (pr) {
      document.title = `#${pr.number} ${pr.title} — Diff Dad`;
    }
  }, [pr]);
  useLiveStream();
  useKeyboardShortcuts();
  const [activityOpen, setActivityOpen] = useState(false);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);

  useEffect(() => {
    if (narrative && generating) setGenerating(false);
  }, [narrative, generating, setGenerating]);

  const showLoadingMessages = loading || generating;
  useEffect(() => {
    if (!showLoadingMessages) return;
    const t = setInterval(() => setLoadingMsgIndex((i) => (i + 1) % copy.loadingMessages.length), 2500);
    return () => clearInterval(t);
  }, [showLoadingMessages]);

  useEffect(() => {
    const applyTheme = () => {
      const resolved =
        theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    };
    applyTheme();
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', applyTheme);
      return () => mq.removeEventListener('change', applyTheme);
    }
  }, [theme]);

  useEffect(() => {
    if (accent === 'classic') {
      document.documentElement.removeAttribute('data-accent');
    } else {
      document.documentElement.setAttribute('data-accent', accent);
    }
  }, [accent]);

  useEffect(() => {
    const { markBg } = getAccentMeta(accent);
    const svg = renderDadMarkSVG({ size: 32, bg: markBg, shape: 'circle', showBadge: false });
    const encoded = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }
    link.href = encoded;
  }, [accent]);

  // Escape closes the activity drawer when nothing else is open.
  useEffect(() => {
    if (!activityOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (shortcutsHelpOpen) return;
      e.preventDefault();
      setActivityOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activityOpen, shortcutsHelpOpen]);

  if (loading && !pr) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--fg-2)]">
        <p className="text-base">{copy.loadingMessages[loadingMsgIndex]}</p>
      </main>
    );
  }

  if (error) {
    const lower = error.toLowerCase();
    const isOffline = lower.includes('fetch') || lower.includes('network');
    const headline = isOffline ? copy.offline : copy.errorGeneric;
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--fg-2)]">
        <div className="text-center">
          <p className="text-base">{headline}</p>
          <p className="mt-2 text-sm text-[var(--fg-3)]">{error}</p>
        </div>
      </main>
    );
  }

  if (generating || !narrative) {
    return <GeneratingScreen message={copy.loadingMessages[loadingMsgIndex] ?? ''} />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-20 text-[var(--fg-1)]">
      <AppBar onOpenActivity={() => setActivityOpen(true)} />
      <PRHeader />
      {view === 'story' ? <StoryView /> : view === 'files' ? <ClassicView /> : <RecapView />}
      <SubmitBar />
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <ShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
    </div>
  );
}
