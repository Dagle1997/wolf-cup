/**
 * Playwright config for the BROCHURE capture (2026-06-23). Runs the dedicated
 * F1-money brochure seed, serves tournament-api FROM SOURCE with the F1 money
 * flag ON, runs vite, and drives brochure.spec.ts to screenshot the Wolf-style
 * leaderboard (money cards expanded) + the condensed score-entry at phone
 * viewport. Not CI; run by hand:
 *   pnpm --filter @tournament/web exec playwright test --config brochure.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(fileURLToPath(import.meta.url), '..');
const TMP = resolve(dir, 'e2e', '.tmp');
const DB_PATH = resolve(TMP, 'brochure.db').replace(/\\/g, '/');
const BROCHURE_HANDOFF = resolve(TMP, 'brochure-handoff.json').replace(/\\/g, '/');
const WEB_PORT = 5173;
const API_PORT = 3000;

const API_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DB_PATH,
  BROCHURE_HANDOFF,
  PORT: String(API_PORT),
  AUTH_COOKIE_DOMAIN: 'localhost',
  PUBLIC_APP_URL: `http://localhost:${WEB_PORT}`,
  GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  ANTHROPIC_API_KEY: 'test-anthropic-key-not-a-real-secret',
  LOG_DIR: resolve(TMP, 'logs').replace(/\\/g, '/'),
  // The whole point: expose F1 dollars so the leaderboard $ + scorecard $ render.
  TOURNAMENT_F1_MONEY_ENABLED: 'true',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: 'brochure.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: { baseURL: `http://localhost:${WEB_PORT}`, actionTimeout: 10_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'pnpm --filter @tournament/api exec tsx src/db/brochure-seed.ts && ' +
        'pnpm --filter @tournament/api exec tsx src/index.ts',
      url: `http://localhost:${API_PORT}/api/auth/status`,
      env: API_ENV,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @tournament/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
