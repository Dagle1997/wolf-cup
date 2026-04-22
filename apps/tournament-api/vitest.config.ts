import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // env.ts parses process.env at module-load time. setupFiles runs
    // BEFORE any test code imports env/session/middleware, so we inject
    // test-appropriate values here to keep Zod happy.
    setupFiles: ['./src/test-setup.ts'],
  },
});
