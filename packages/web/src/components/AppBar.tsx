import { useReviewStore } from "../state/review-store";
import { LivePill } from "./LivePill";
import { IconGear, IconMoon, IconSun } from "./Icons";

function repoSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1] : null;
}

type AppBarProps = {
  onOpenActivity: () => void;
  onOpenTweaks: () => void;
};

export function AppBar({ onOpenActivity, onOpenTweaks }: AppBarProps) {
  const pr = useReviewStore((s) => s.pr);
  const theme = useReviewStore((s) => s.theme);
  const setTheme = useReviewStore((s) => s.setTheme);
  const repoUrl = useReviewStore((s) => s.repoUrl);

  const slug = repoSlug(repoUrl);
  const prNum = pr ? pr.number : null;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Brand mark */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center bg-brand text-white"
          style={{ width: 22, height: 22, borderRadius: 6 }}
        >
          <span className="text-[13px] font-bold leading-none">D</span>
        </div>
        <span className="text-[15px] font-bold tracking-tight text-gray-900 dark:text-gray-50">
          Diff Dad
        </span>
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-gray-200 dark:bg-gray-800" />

      {/* CLI framing */}
      <div className="flex min-w-0 items-center gap-2 font-mono text-[13px] text-gray-600 dark:text-gray-300">
        <span className="font-bold text-brand">$</span>
        <span className="rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          dad review {prNum ?? "—"}
        </span>
        <span className="text-gray-400 dark:text-gray-500">→</span>
        <span className="truncate text-gray-600 dark:text-gray-300">
          {slug ? (
            <>
              <span className="font-bold text-brand">{slug}</span>
              {prNum != null ? `#${prNum}` : null}
            </>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Live pill */}
        <LivePill onClick={onOpenActivity} />

        {/* Tweaks */}
        <button
          type="button"
          aria-label="Open tweaks"
          onClick={onOpenTweaks}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <IconGear className="h-4 w-4" />
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
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
          className="flex items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ width: 28, height: 28, background: "#6565EC" }}
        >
          DD
        </div>
      </div>
    </header>
  );
}
