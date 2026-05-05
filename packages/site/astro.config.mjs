// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// On Cloudflare Pages, CF_PAGES_URL is the actual deploy URL (preview or prod).
// Falling back to the production hostname keeps local builds canonical.
const site = process.env.CF_PAGES_URL || 'https://diff.dad';

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    // @ts-expect-error — vite version skew: web pulls vite@6, astro@6 brings vite@7;
    // @tailwindcss/vite resolves against the older one but works at runtime.
    plugins: [tailwindcss()],
  },
});
