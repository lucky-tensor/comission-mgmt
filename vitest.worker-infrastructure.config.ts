import { defineConfig } from 'vitest/config';
import { vitestAliases } from './vitest.aliases';

export default defineConfig({
  resolve: {
    alias: vitestAliases(__dirname),
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    include: ['tests/api/worker-infrastructure/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build'],
  },
});
