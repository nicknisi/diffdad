import { useState } from "react";
import { getAuthorInfo } from "../lib/authors";
import type { PRComment } from "../state/types";
import { IconSpark } from "./Icons";
import { Markdown } from "./markdown/Markdown";

const RECENT_SYNC_WINDOW_MS = 60_000;

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
  replies?: PRComment[];
  isReply?: boolean;
};

function provenance(
  comment: PRComment
): { kind: "draft" | "synced" | "github" } {
  if (comment.id < 0) return { kind: "draft" };
  const created = new Date(comment.createdAt).getTime();
  if (
    !Number.isNaN(created) &&
    Date.now() - created < RECENT_SYNC_WINDOW_MS &&
    comment.id > 0
  ) {
    return { kind: "synced" };
  }
  return { kind: "github" };
}

export function Comment({ comment, replies = [], isReply = false }: Props) {
  const info = getAuthorInfo(comment.author);
  const isBot = info.isBot;
  const { kind } = provenance(comment);
  const [collapsed, setCollapsed] = useState(false);

  const badgeText =
    kind === "draft"
      ? "draft"
      : kind === "synced"
        ? "synced"
        : "from GitHub";
  const badgeClass =
    kind === "draft"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : kind === "synced"
        ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
        : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";

  return (
    <div
      className={
        isReply
          ? "rounded-lg bg-white p-3 dark:bg-gray-900"
          : "rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
      }
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: info.color }}
        >
          {info.initials}
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {info.displayName}
        </span>
        {isBot && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-brand">
            <IconSpark className="h-3 w-3" />
            bot
          </span>
        )}
        <span className="text-sm text-gray-400 dark:text-gray-500">
          {relativeTime(comment.createdAt)}
        </span>
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
        >
          {badgeText}
        </span>
      </div>
      <div className="mt-2">
        <Markdown source={comment.body} />
      </div>
      {replies.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {collapsed
              ? `Show ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
              : `Hide ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </button>
          {!collapsed && (
            <div className="mt-2 space-y-2 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
              {replies.map((r) => (
                <Comment key={r.id} comment={r} isReply />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
