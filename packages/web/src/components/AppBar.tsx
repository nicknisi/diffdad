import { useReviewStore } from "../state/review-store";
import { LivePill } from "./LivePill";
import { IconMoon, IconSun, IconArrowRight } from "./Icons";

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
    <header
      className="sticky top-0 z-30 flex h-[52px] items-center gap-3.5 bg-[var(--bg-panel)] px-[18px]"
      style={{ boxShadow: "inset 0 -1px 0 var(--gray-a4)" }}
    >
      {/* Brand mark */}
      <div className="flex items-center gap-2 text-[14px] font-bold tracking-[-0.01em]">
        <div
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[var(--brand)] text-white"
          style={{
            boxShadow:
              "0 1px 2px rgba(3,2,13,0.06), 0 3px 6px -1px rgba(3,2,13,0.10)",
          }}
        >
          <span className="text-[13px] font-bold leading-none">D</span>
        </div>
        <span className="text-[var(--fg-1)]">Diff Dad</span>
      </div>

      {/* Separator */}
      <span
        aria-hidden
        className="mx-1 inline-block h-5 w-px"
        style={{ background: "var(--gray-a4)" }}
      />

      {/* CLI framing */}
      <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[12.5px] font-medium text-[var(--fg-2)]">
        <span className="font-bold text-[var(--purple-10,_var(--brand-hover))]" style={{ color: "var(--purple-10)" }}>
          $
        </span>
        <span
          className="whitespace-nowrap rounded-[4px] bg-[var(--gray-3)] px-2 py-0.5 text-[var(--fg-1)]"
          style={{ boxShadow: "inset 0 0 0 1px var(--gray-a5)" }}
        >
          dad review {prNum ?? "—"}
        </span>
        <span className="inline-flex text-[var(--fg-3)]">
          <IconArrowRight className="h-[11px] w-[11px]" />
        </span>
        <span className="truncate text-[13px] font-medium text-[var(--fg-1)] font-sans">
          {slug ? (
            <>
              <span className="font-semibold" style={{ color: "var(--purple-11)" }}>
                {slug}
              </span>
              {prNum != null ? `#${prNum}` : null}
            </>
          ) : (
            <span className="text-[var(--fg-3)]">—</span>
          )}
        </span>
        <span className="ml-auto font-mono text-[11px] font-medium text-[var(--fg-3)]">
          pid 41278
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Live pill */}
        <LivePill onClick={onOpenActivity} />

        {/* Theme toggle */}
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[var(--bg-panel)] text-[var(--fg-2)] hover:bg-[var(--gray-2)] hover:text-[var(--fg-1)]"
          style={{ boxShadow: "inset 0 0 0 1px var(--gray-a5)" }}
        >
          {theme === "dark" ? (
            <IconSun className="h-[15px] w-[15px]" />
          ) : (
            <IconMoon className="h-[15px] w-[15px]" />
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
