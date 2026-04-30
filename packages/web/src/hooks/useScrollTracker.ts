import { useEffect } from "react";
import { useReviewStore } from "../state/review-store";

export function useScrollTracker() {
  const narrative = useReviewStore((s) => s.narrative);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);

  useEffect(() => {
    if (!narrative) return;

    function onScroll() {
      if (!narrative) return;
      const offset = window.scrollY + 120;
      const discussionEl = document.querySelector('[data-chid="discussion"]');
      if (discussionEl && (discussionEl as HTMLElement).offsetTop <= offset) {
        setActiveChapter("discussion");
        return;
      }
      for (let i = narrative.chapters.length - 1; i >= 0; i--) {
        const el = document.querySelector(`[data-chid="ch-${i}"]`);
        if (el && (el as HTMLElement).offsetTop <= offset) {
          setActiveChapter(`ch-${i}`);
          return;
        }
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [narrative, setActiveChapter]);
}
