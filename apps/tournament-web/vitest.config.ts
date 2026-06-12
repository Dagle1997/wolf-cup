import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // T2-3b: jsdom (was 'node') so component tests can render React + simulate
    // user-event interactions. Pure-Node tests (e.g., src/lib/query-client.test.ts)
    // continue to work under jsdom — they use no DOM APIs.
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The Playwright browser E2E (T14-1) lives in e2e/*.spec.ts and is run by
    // `playwright test`, NOT vitest — exclude it so vitest's default *.spec.ts
    // glob doesn't try to collect it (its @playwright/test import isn't a
    // vitest runtime and errors collection).
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
