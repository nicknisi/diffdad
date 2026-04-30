import type { PRComment } from "../state/types";
import { Markdown } from "./markdown/Markdown";

const AVATAR_PALETTE = [
  "bg-brand",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
];

function avatarColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = (hash * 31 + author.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length] ?? "bg-brand";
}

function initials(author: string): string {
  const cleaned = author.replace(/\[bot\]$/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

type Props = {
  comment: PRComment;
};

export function Comment({ comment }: Props) {
  const isBot = /\[bot\]$/.test(comment.author);
  const isDraft = comment.id < 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(comment.author)}`}
        >
          {initials(comment.author)}
        </div>
        <span className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100">
          {comment.author}
        </span>
        {isBot && (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand">
            ✦ bot
          </span>
        )}
        <span className="text-[12px] text-gray-400 dark:text-gray-500">
          {relativeTime(comment.createdAt)}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10.5px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          {isDraft ? "draft" : "from GitHub"}
        </span>
      </div>
      <div className="mt-2">
        <Markdown source={comment.body} />
      </div>
    </div>
  );
}
