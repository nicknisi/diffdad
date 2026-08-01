// `vitest/config` rather than `vite`, so the `test` block below is type-checked (it is part of the
// package's tsconfig include list).
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4317',
        changeOrigin: true,
      },
    },
  },
  test: {
    // `node` stays the default, and deliberately: the store's `safeStorage` no-ops without a
    // `localStorage` global, so `state/__tests__/durable-review-state.test.ts` installs a Map-backed shim
    // by assigning `globalThis.localStorage` — which a DOM environment already owns as a read-only
    // accessor. Component tests that need a real DOM opt in per file with
    // `// @vitest-environment happy-dom` (see `components/__tests__/chapter-precedence.test.tsx`), which
    // is what makes mount-then-update behaviour testable without changing the suite underneath everything
    // else.
    environment: 'node',
  },
});
