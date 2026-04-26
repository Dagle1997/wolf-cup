import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // T2-3b: jsdom (was 'node') so component tests can render React + simulate
    // user-event interactions. Pure-Node tests (e.g., src/lib/query-client.test.ts)
    // continue to work under jsdom — they use no DOM APIs.
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
