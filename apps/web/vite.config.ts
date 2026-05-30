/**
 * Vite configuration for the commission management web frontend.
 *
 * The SPA calls the API under the `/api` prefix; the server exposes those
 * routes unprefixed (`/me/...`, `/demo/...`), so the proxy strips `/api` before
 * forwarding to the backend (defaults to localhost:31415; override via
 * VITE_API_TARGET for the browser/E2E harness's ephemeral server port).
 *
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:31415';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/healthz': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/readyz': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
