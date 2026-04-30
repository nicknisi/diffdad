import { useReviewStore } from "../state/review-store";

export function AppBar() {
  const pr = useReviewStore((s) => s.pr);
  const theme = useReviewStore((s) => s.theme);
  const setTheme = useReviewStore((s) => s.setTheme);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-brand text-[12px] font-bold text-white">
          D
        </div>
        <span className="text-[14px] font-bold tracking-tight text-gray-900 dark:text-gray-50">
          Diff Dad
        </span>
      </div>
      <div className="h-5 w-px bg-gray-200 dark:bg-gray-800" />
      <div className="flex min-w-0 items-center gap-2 font-mono text-[12.5px] text-gray-500 dark:text-gray-400">
        <span className="text-gray-400 dark:text-gray-500">$</span>
        <span className="truncate">
          dad review {pr ? pr.number : "—"}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <span className="text-[14px]">{theme === "dark" ? "☀" : "☾"}</span>
        </button>
      </div>
    </header>
  );
}
