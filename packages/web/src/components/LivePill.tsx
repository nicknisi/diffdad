import { useEffect, useState } from "react";
import { useReviewStore } from "../state/review-store";

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

type Props = {
  onClick: () => void;
};

export function LivePill({ onClick }: Props) {
  const status = useReviewStore((s) => s.liveStatus);
  const eventCount = useReviewStore((s) => s.liveEvents.length);
  const lastEventAt = useReviewStore((s) => s.lastEventAt);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  let label: string;
  let bgClass: string;
  let dotClass: string;
  let textClass: string;

  if (status === "connected") {
    label = `Live · ${eventCount} event${eventCount === 1 ? "" : "s"} · last ${formatRelative(now - lastEventAt)}`;
    bgClass = "bg-green-100 dark:bg-green-950/40";
    dotClass = "bg-green-500 animate-pulse";
    textClass = "text-green-800 dark:text-green-300";
  } else if (status === "connecting") {
    label = "Connecting...";
    bgClass = "bg-amber-100 dark:bg-amber-950/40";
    dotClass = "bg-amber-500 animate-pulse";
    textClass = "text-amber-800 dark:text-amber-300";
  } else {
    label = "Offline";
    bgClass = "bg-gray-100 dark:bg-gray-800";
    dotClass = "bg-gray-400";
    textClass = "text-gray-700 dark:text-gray-300";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open activity drawer"
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition hover:brightness-95 ${bgClass} ${textClass}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
