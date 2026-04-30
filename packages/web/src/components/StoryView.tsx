import { useScrollTracker } from "../hooks/useScrollTracker";
import { normalizePath } from "../lib/paths";
import { useReviewStore } from "../state/review-store";
import { Chapter } from "./Chapter";
import { ChapterTOC } from "./ChapterTOC";
import { Comment } from "./Comment";
import { SuggestedStart } from "./SuggestedStart";

function Discussion() {
  const comments = useReviewStore((s) => s.comments);
  const narrative = useReviewStore((s) => s.narrative);

  if (!narrative) return null;

  const narrativeFiles = new Set<string>();
  narrative.chapters.forEach((ch) => {
    ch.sections.forEach((s) => {
      if (s.type === "diff") narrativeFiles.add(normalizePath(s.file));
    });
  });

  // PR-level comments (no path) or comments on files that aren't in any
  // chapter's diff section. Without this, those comments would never render.
  const unmatched = comments.filter((c) => {
    if (!c.path) return true;
    return !narrativeFiles.has(normalizePath(c.path));
  });

  if (unmatched.length === 0) return null;

  // Group reply chains under their parents so threads stay together.
  const byId = new Map(unmatched.map((c) => [c.id, c]));
  const repliesByParent = new Map<number, typeof unmatched>();
  const roots: typeof unmatched = [];
  for (const c of unmatched) {
    if (c.inReplyToId !== undefined && byId.has(c.inReplyToId)) {
      const list = repliesByParent.get(c.inReplyToId) ?? [];
      list.push(c);
      repliesByParent.set(c.inReplyToId, list);
    } else {
      roots.push(c);
    }
  }

  return (
    <section className="mt-10 border-t pt-6" style={{ borderColor: "var(--gray-a4)" }}>
      <h3 className="mb-3 text-[15px] font-semibold text-[var(--fg-1)]">
        Discussion
      </h3>
      <p className="mb-4 text-[12.5px] text-[var(--fg-3)]">
        PR-level comments and notes on files that don't appear in the narrative.
      </p>
      <div className="space-y-2">
        {roots.map((c) => (
          <Comment
            key={c.id}
            comment={c}
            replies={repliesByParent.get(c.id) ?? []}
          />
        ))}
      </div>
    </section>
  );
}

export function StoryView() {
  useScrollTracker();
  const narrative = useReviewStore((s) => s.narrative);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  if (!narrative) return null;

  const compact = displayDensity === "compact";
  const padY = compact ? "py-4" : "pt-[18px] pb-20";

  if (layoutMode === "linear") {
    return (
      <div className={`mx-auto max-w-[880px] px-6 ${padY}`}>
        <main>
          <SuggestedStart />
          {narrative.chapters.map((ch, idx) => (
            <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
          ))}
          <Discussion />
        </main>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto grid max-w-[1100px] grid-cols-[220px_minmax(0,1fr)] gap-7 px-6 ${padY}`}
    >
      <ChapterTOC />
      <main className="min-w-0">
        <SuggestedStart />
        {narrative.chapters.map((ch, idx) => (
          <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
        ))}
        <Discussion />
      </main>
    </div>
  );
}
