import { useState, type KeyboardEvent } from "react";
import { useComments } from "../hooks/useComments";
import { useReviewStore } from "../state/review-store";
import { IconChat, IconRefresh, IconSpark, IconX } from "./Icons";

type Density = "terse" | "normal" | "verbose";
type Lens = "security" | "performance" | "API consumer" | null;

const DENSITIES: Density[] = ["terse", "normal", "verbose"];
const LENS_CYCLE: Exclude<Lens, null>[] = [
  "security",
  "performance",
  "API consumer",
];

type Props = {
  chapterIndex: number;
};

export function NarrationAnchor({ chapterIndex }: Props) {
  const chapterKey = `ch-${chapterIndex}`;
  const globalDensity = useReviewStore((s) => s.density);
  const chapterDensityMap = useReviewStore((s) => s.chapterDensity);
  const setChapterDensity = useReviewStore((s) => s.setChapterDensity);
  const activeDensity = chapterDensityMap[chapterKey] ?? globalDensity;

  const [renarrating, setRenarrating] = useState(false);
  const [lens, setLens] = useState<Lens>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askPrompt, setAskPrompt] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askResponse, setAskResponse] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const { postComment } = useComments();

  function handleRenarrate() {
    if (renarrating) return;
    setRenarrating(true);
    // Cycle: null -> security -> performance -> API consumer -> null
    const idx = lens === null ? 0 : LENS_CYCLE.indexOf(lens) + 1;
    const next: Lens = idx >= LENS_CYCLE.length ? null : LENS_CYCLE[idx] ?? null;
    window.setTimeout(() => {
      setLens(next);
      setRenarrating(false);
    }, 700);
  }

  function handleRestoreDefault() {
    setLens(null);
  }

  function submitAsk() {
    const trimmed = askPrompt.trim();
    if (!trimmed || askLoading) return;
    setAskLoading(true);
    setAskResponse(null);
    window.setTimeout(() => {
      setAskResponse(
        "AI responses will be powered by your configured LLM provider.",
      );
      setAskLoading(false);
    }, 600);
  }

  function onAskKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitAsk();
    }
  }

  function closeAsk() {
    setAskOpen(false);
    setAskPrompt("");
    setAskResponse(null);
  }

  async function submitComment() {
    const trimmed = commentBody.trim();
    if (!trimmed || commentSubmitting) return;
    setCommentSubmitting(true);
    setCommentError(null);
    try {
      const body = `[diff.dad: Chapter ${chapterIndex + 1}] ${trimmed}`;
      await postComment(body);
      setCommentBody("");
      setCommentOpen(false);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setCommentSubmitting(false);
    }
  }

  function onCommentKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submitComment();
    }
  }

  return (
    <div className="ml-[34px] mt-2">
      {lens && !renarrating && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300">
          <span>
            Re-narrated for <span className="font-medium">{lens}</span>{" "}
            reviewers
          </span>
          <span className="text-gray-400">·</span>
          <button
            type="button"
            onClick={handleRestoreDefault}
            className="font-medium text-brand hover:underline"
          >
            Restore default
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-400">
        <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-800 dark:bg-gray-900">
          {DENSITIES.map((d) => {
            const active = d === activeDensity;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setChapterDensity(chapterKey, d)}
                className={
                  active
                    ? "rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium capitalize text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    : "rounded-md border border-transparent px-2 py-0.5 text-xs font-medium capitalize text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }
              >
                {d}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleRenarrate}
          disabled={renarrating}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          {renarrating ? "Re-narrating..." : "Re-narrate"}
        </button>

        <button
          type="button"
          onClick={() => setAskOpen((v) => !v)}
          className={
            askOpen
              ? "inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-sm font-medium text-brand"
              : "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          }
        >
          <IconSpark className="h-3.5 w-3.5" />
          Ask AI
        </button>

        <button
          type="button"
          onClick={() => setCommentOpen((v) => !v)}
          className={
            commentOpen
              ? "inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              : "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          }
        >
          <IconChat className="h-3.5 w-3.5" />
          Comment on chapter
        </button>
      </div>

      {askOpen && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
          <textarea
            autoFocus
            value={askPrompt}
            onChange={(e) => setAskPrompt(e.target.value)}
            onKeyDown={onAskKeyDown}
            placeholder="e.g. Why this timeout? What does this Zod schema cover?"
            className="block w-full resize-y rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand dark:border-gray-800 dark:text-gray-100"
            rows={2}
          />
          {askResponse && (
            <div className="mt-2 rounded-md bg-gray-50 p-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {askResponse}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAsk}
              aria-label="Close"
              className="inline-flex items-center justify-center rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <IconX className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!askPrompt.trim() || askLoading}
              onClick={submitAsk}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {askLoading ? "Asking..." : "Ask"}
            </button>
          </div>
        </div>
      )}

      {commentOpen && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
          <textarea
            autoFocus
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            onKeyDown={onCommentKeyDown}
            placeholder={`Comment on Chapter ${chapterIndex + 1}. Cmd/Ctrl+Enter to submit.`}
            className="block w-full resize-y rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand dark:border-gray-800 dark:text-gray-100"
            rows={3}
          />
          {commentError && (
            <div className="mt-1 text-sm text-red-600 dark:text-red-400">
              {commentError}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCommentBody("");
                setCommentOpen(false);
                setCommentError(null);
              }}
              className="rounded-md px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!commentBody.trim() || commentSubmitting}
              onClick={() => void submitComment()}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {commentSubmitting ? "Posting..." : "Comment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
