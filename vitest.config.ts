// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:59:41.712Z | xcoder:subtask test-st-bf6f22
import { defineConfig } from 'vitest/config';

/**
 * Unit/contract test runner for Xcoder Dojo.
 *
 * environment: 'node' on purpose - the backend layers are pure TypeScript and
 * the UI layer is asserted through react-dom/server, so no jsdom shim is
 * needed and no test can accidentally depend on browser-only globals.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
