import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site under the repo's name; the Pages workflow sets PAGES_BASE to it. Locally it is the root.
  base: process.env.PAGES_BASE ?? '/',
  // three.js alone is about 700 kB minified: one chunk is fine for a demo.
  build: { chunkSizeWarningLimit: 1000 },
  test: { include: ['tests/**/*.test.ts'] },
});
