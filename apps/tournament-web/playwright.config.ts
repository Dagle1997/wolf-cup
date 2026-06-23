/**
 * Playwright config for the tournament-web browser E2E suite (T14-1).
 *
 * The FIRST real-browser coverage for the app — closes the gap unit/jsdom
 * tests structurally cannot reach (score entry, the IndexedDB offline queue,
 * the start-round picker), exactly the class of bug that bit Wolf Cup's
 * score-entry service-worker freeze (caught only by a phone at the course).
 *
 * Two webServers are launched and torn down by Playwright:
 *   - api: seeds a throwaway file DB (real-app-in-process + real session),
 *          then serves tournament-api FROM SOURCE via tsx. Running source
 *          (not dist/) avoids the stale-build trap — the Docker-build CI step
 *          separately validates the tsc artifact.
 *   - web: vite dev on :5173 (its existing proxy forwards /api → :3000).
 *
 * Auth: the seed mints a real `tournament_session`; specs attach it via
 * context cookies (no Google OAuth UI, which can't run headless).
 */
import { defineConfig, devices } from '@playwright/test';
import { API_ENV, API_URL, WEB_PORT, WEB_URL } from './e2e/_fixture';

const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // brochure.spec.ts is a manual marketing-capture spec driven ONLY by
  // brochure.config.ts (its own seed + money flag). Exclude it from the regular
  // e2e run, which seeds the standard non-F1 fixture and has no brochure handoff.
  testIgnore: '**/brochure.spec.ts',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Seed the throwaway DB, then serve the API from source. `&&` guarantees
      // seed-before-serve; if the seed fails, serve never binds and Playwright
      // surfaces a clear "webServer did not start" with the seed error in logs.
      command:
        'pnpm --filter @tournament/api exec tsx src/db/e2e-seed.ts && ' +
        'pnpm --filter @tournament/api exec tsx src/index.ts',
      url: `${API_URL}/api/auth/status`,
      env: API_ENV,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @tournament/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
