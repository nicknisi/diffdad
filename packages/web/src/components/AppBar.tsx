import { useReviewStore } from "../state/review-store";
import { LivePill } from "./LivePill";
import { IconMoon, IconSun } from "./Icons";

function repoSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1] : null;
}

type AppBarProps = {
  onOpenActivity: () => void;
};

export function AppBar({ onOpenActivity }: AppBarProps) {
  const pr = useReviewStore((s) => s.pr);
  const theme = useReviewStore((s) => s.theme);
  const setTheme = useReviewStore((s) => s.setTheme);
  const repoUrl = useReviewStore((s) => s.repoUrl);

  const slug = repoSlug(repoUrl);
  const prNum = pr ? pr.number : null;

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3.5 border-b border-[var(--border)] bg-[var(--bg-panel)] px-[18px]">
      {/* Brand mark */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[var(--brand)] text-white shadow-[var(--shadow-card)]"
        >
          <span className="text-[13px] font-bold leading-none">D</span>
        </div>
        <span className="text-[14px] font-bold tracking-[-0.01em] text-[var(--fg-1)]">
          Diff Dad
        </span>
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-[var(--border)]" />

      {/* CLI framing */}
      <div className="flex min-w-0 items-center gap-2 font-mono text-[12.5px] font-medium text-[var(--fg-2)]">
        <span className="font-bold text-[var(--brand)]">$</span>
        <span className="rounded-[4px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[var(--fg-1)]">
          dad review {prNum ?? "—"}
        </span>
        <span className="text-[var(--fg-3)]">→</span>
        <span className="truncate text-[var(--fg-2)]">
          {slug ? (
            <>
              <span className="font-semibold text-[var(--brand)]">{slug}</span>
              {prNum != null ? `#${prNum}` : null}
            </>
          ) : (
            <span className="text-[var(--fg-3)]">—</span>
          )}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Live pill */}
        <LivePill onClick={onOpenActivity} />

        {/* Theme toggle */}
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-panel)] text-[var(--fg-2)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg-1)]"
        >
          {theme === "dark" ? (
            <IconSun className="h-4 w-4" />
          ) : (
            <IconMoon className="h-4 w-4" />
          )}
        </button>

        {/* Avatar */}
        <div
          aria-label="User avatar"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-white"
        >
          DD
        </div>
      </div>
    </header>
  );
}
