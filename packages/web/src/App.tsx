import { useEffect } from "react";
import { useReviewStore } from "./state/review-store";
import { useNarrative } from "./hooks/useNarrative";
import { AppBar } from "./components/AppBar";
import { PRHeader } from "./components/PRHeader";
import { StoryView } from "./components/StoryView";
import { SubmitBar } from "./components/SubmitBar";
import { copy } from "./lib/microcopy";

export default function App() {
  const theme = useReviewStore((s) => s.theme);
  const { loading, error } = useNarrative();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600 dark:bg-gray-950 dark:text-gray-400">
        <p className="text-[14.5px]">{copy.loading}</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600 dark:bg-gray-950 dark:text-gray-400">
        <div className="text-center">
          <p className="text-[14.5px]">{copy.errorGeneric}</p>
          <p className="mt-2 text-[12px] text-gray-400">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <AppBar />
      <PRHeader />
      <StoryView />
      <SubmitBar />
    </div>
  );
}
