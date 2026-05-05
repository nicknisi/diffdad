import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** Backstop for render errors thrown anywhere below it. Without this, an
 * unhandled error during render unmounts the entire React tree and the user
 * sees a blank white page — most often during narrative streaming when a
 * partial chapter object is missing a field a renderer expected. We catch,
 * log, and offer a "try again" affordance so the user never has to hard
 * refresh to recover. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Diff Dad render error:', error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || String(this.state.error);
    return (
      <main
        role="alert"
        className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] px-6 text-[var(--fg-2)]"
      >
        <div className="max-w-[420px] text-center">
          <p className="text-base font-semibold text-[var(--fg-1)]">Something glitched while rendering.</p>
          <p className="mt-2 text-sm text-[var(--fg-3)]">{message}</p>
          <p className="mt-4 text-xs text-[var(--fg-3)]">
            Your data is fine — this happens occasionally during narrative streaming. Try again, or refresh if it
            persists.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-5 inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--brand)] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[var(--brand-hover)]"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }
}
