/**
 * Vite configuration for the commission management web frontend.
 *
 * Phase 1 Foundation: blank React shell — UI implemented in later issues.
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
        target: 'http://localhost:31415',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:31415',
        changeOrigin: true,
      },
      '/readyz': {
        target: 'http://localhost:31415',
        changeOrigin: true,
      },
    },
  },
});
