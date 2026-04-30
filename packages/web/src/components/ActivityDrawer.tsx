import { useEffect, useState } from "react";
import { useReviewStore } from "../state/review-store";
import type { LiveEvent } from "../state/types";

type Props = {
  open: boolean;
  onClose: () => void;
};

const ICON_BY_KIND: Record<string, string> = {
  comment: "💬",
  ci: "✓",
  commit: "📦",
  system: "⚡",
};

function iconFor(kind: string): string {
  return ICON_BY_KIND[kind] ?? "•";
}

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "disconnected":
      return "Offline";
    default:
      return status;
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case "connected":
      return "bg-green-500 animate-pulse";
    case "connecting":
      return "bg-amber-500 animate-pulse";
    default:
      return "bg-gray-400";
  }
}

export function ActivityDrawer({ open, onClose }: Props) {
  const events = useReviewStore((s) => s.liveEvents);
  const status = useReviewStore((s) => s.liveStatus);
  const [now, setNow] = useState(() => Date.now());
  const [mounted, setMounted] = useState(open);
  const [animateIn, setAnimateIn] = useState(false);

  // Tick every 5s to refresh relative timestamps
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [open]);

  // Mount/unmount with slide animation
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame: animate in
      const id = requestAnimationFrame(() => setAnimateIn(true));
      return () => cancelAnimationFrame(id);
    } else {
      setAnimateIn(false);
      const id = setTimeout(() => setMounted(false), 240);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-40" aria-hidden={!open}>
      {/* Backdrop scrim */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/20 transition-opacity duration-[240ms] ${
          animateIn ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        className={`absolute right-0 top-0 flex h-full w-[380px] flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-[240ms] ease-out dark:border-gray-800 dark:bg-gray-900 ${
          animateIn ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">
            Activity
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close activity"
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <span className="text-base leading-none">×</span>
          </button>
        </div>

        {/* Subhead: status + count */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
          <span
            className={`inline-block h-2 w-2 rounded-full ${statusDotClass(status)}`}
          />
          <span>{statusLabel(status)}</span>
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <span>
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No activity yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {events.map((ev: LiveEvent) => (
                <li
                  key={ev.id}
                  className="flex items-start gap-3 px-4 py-3 text-sm"
                >
                  <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-sm dark:bg-gray-800">
                    {iconFor(ev.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-gray-900 dark:text-gray-100">
                      {ev.summary}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      {formatRelative(now - ev.timestamp)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
