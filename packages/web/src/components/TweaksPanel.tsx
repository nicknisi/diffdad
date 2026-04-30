import { useEffect, useState } from "react";
import { useReviewStore } from "../state/review-store";

type Props = {
  open: boolean;
  onClose: () => void;
};

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-800 dark:bg-gray-900"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              active
                ? "rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                : "rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        checked
          ? "bg-brand"
          : "bg-gray-300 dark:bg-gray-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {label}
        </div>
        {hint && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {hint}
          </div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 px-1 pb-1 text-xs font-bold uppercase tracking-[0.06em] text-gray-400 dark:text-gray-500">
      {children}
    </div>
  );
}

export function TweaksPanel({ open, onClose }: Props) {
  const storyStructure = useReviewStore((s) => s.storyStructure);
  const setStoryStructure = useReviewStore((s) => s.setStoryStructure);
  const visualStyle = useReviewStore((s) => s.visualStyle);
  const setVisualStyle = useReviewStore((s) => s.setVisualStyle);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const setLayoutMode = useReviewStore((s) => s.setLayoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  const setDisplayDensity = useReviewStore((s) => s.setDisplayDensity);
  const collapseNarration = useReviewStore((s) => s.collapseNarration);
  const setCollapseNarration = useReviewStore((s) => s.setCollapseNarration);
  const clusterBots = useReviewStore((s) => s.clusterBots);
  const setClusterBots = useReviewStore((s) => s.setClusterBots);
  const density = useReviewStore((s) => s.density);
  const setDensity = useReviewStore((s) => s.setDensity);

  const [mounted, setMounted] = useState(open);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setAnimateIn(true));
      return () => cancelAnimationFrame(id);
    } else {
      setAnimateIn(false);
      const id = setTimeout(() => setMounted(false), 240);
      return () => clearTimeout(id);
    }
  }, [open]);

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
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/20 transition-opacity duration-[240ms] ${
          animateIn ? "opacity-100" : "opacity-0"
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Tweaks"
        className={`absolute right-0 top-0 flex h-full w-[380px] flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-[240ms] ease-out dark:border-gray-800 dark:bg-gray-900 ${
          animateIn ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">
            Tweaks
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tweaks"
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <span className="text-base leading-none">×</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <SectionHeader>Story</SectionHeader>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <Row label="Story structure">
              <Segmented
                ariaLabel="Story structure"
                value={storyStructure}
                onChange={setStoryStructure}
                options={[
                  { value: "chapters", label: "Chapters" },
                  { value: "linear", label: "Linear" },
                  { value: "outline", label: "Outline" },
                ]}
              />
            </Row>
            <Row label="Narration density">
              <Segmented
                ariaLabel="Narration density"
                value={density}
                onChange={setDensity}
                options={[
                  { value: "terse", label: "Terse" },
                  { value: "normal", label: "Normal" },
                  { value: "verbose", label: "Verbose" },
                ]}
              />
            </Row>
            <Row
              label="Collapse narration"
              hint="Hide AI narration until clicked"
            >
              <Toggle
                ariaLabel="Collapse narration"
                checked={collapseNarration}
                onChange={setCollapseNarration}
              />
            </Row>
          </div>

          <SectionHeader>Layout</SectionHeader>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <Row label="Layout" hint="Show or hide the chapter sidebar">
              <Segmented
                ariaLabel="Layout"
                value={layoutMode}
                onChange={setLayoutMode}
                options={[
                  { value: "toc", label: "TOC" },
                  { value: "linear", label: "Linear" },
                ]}
              />
            </Row>
            <Row label="Display density">
              <Segmented
                ariaLabel="Display density"
                value={displayDensity}
                onChange={setDisplayDensity}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            </Row>
            <Row label="Visual style" hint="Preview only — not yet wired">
              <Segmented
                ariaLabel="Visual style"
                value={visualStyle}
                onChange={setVisualStyle}
                options={[
                  { value: "stripe", label: "Stripe" },
                  { value: "linear", label: "Linear" },
                  { value: "github", label: "GitHub" },
                ]}
              />
            </Row>
          </div>

          <SectionHeader>Behavior</SectionHeader>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <Row
              label="Cluster bot suggestions"
              hint="Group bot comments at the top of each hunk"
            >
              <Toggle
                ariaLabel="Cluster bot suggestions"
                checked={clusterBots}
                onChange={setClusterBots}
              />
            </Row>
          </div>
        </div>
      </aside>
    </div>
  );
}
