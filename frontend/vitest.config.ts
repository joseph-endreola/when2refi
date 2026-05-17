import { defineConfig } from 'vitest/config';

// DSC unit/property tests run in plain Node — no DOM, no React. The Vite
// app config (vite.config.ts) is intentionally not extended here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
