import { defineConfig } from 'vite';

export default defineConfig({
  // Deployment sub-path. Defaults to the domain root; the GitHub Pages workflow
  // sets BASE_PATH=/tales-of-ceylon/. Runtime asset paths go through
  // src/utils/asset-url.js so they follow this value.
  base: process.env.BASE_PATH || '/',
  // 'mpa' disables the SPA history fallback, so a missing optional asset (for
  // example a destination .glb that has not been added yet) returns a real 404
  // instead of index.html, and the procedural placeholder is used.
  appType: 'mpa',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
