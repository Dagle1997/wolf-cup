/**
 * Shared E2E fixture plumbing (T14-1). Single source of truth for the temp
 * paths + placeholder env consumed by BOTH playwright.config.ts (to set the
 * api webServer env) and the specs (to read the seed handoff).
 *
 * Deliberately free of `@playwright/test` value imports so the config can
 * import the paths without a circular load. Browser helpers take their
 * Playwright types as type-only imports.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Forward-slash so libsql's `file:${DB_PATH}` URL parses on Windows + POSIX. */
function fsUrl(p: string): string {
  return p.replace(/\\/g, '/');
}

export const TMP_DIR = resolve(__dirname, '.tmp');
export const DB_PATH = fsUrl(resolve(TMP_DIR, 'e2e.db'));
export const HANDOFF_PATH = fsUrl(resolve(TMP_DIR, 'handoff.json'));
const LOG_DIR = fsUrl(resolve(TMP_DIR, 'logs'));

export const WEB_PORT = 5173;
export const API_PORT = 3000;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/**
 * Placeholder env for the tournament-api process under test. Mirrors
 * apps/tournament-api/src/test-setup.ts — non-secret values that satisfy
 * env.ts's fail-fast schema. NODE_ENV=test keeps the session cookie
 * non-Secure so it works over http://localhost.
 */
export const API_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DB_PATH,
  E2E_HANDOFF: HANDOFF_PATH,
  E2E_RESET: '1',
  PORT: String(API_PORT),
  AUTH_COOKIE_DOMAIN: 'localhost',
  PUBLIC_APP_URL: WEB_URL,
  GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  ANTHROPIC_API_KEY: 'test-anthropic-key-not-a-real-secret',
  LOG_DIR,
};

export interface Handoff {
  eventId: string;
  eventRoundId: string;
  groupId: string;
  organizerId: string;
  /** Organizer's real session — admin/start-round routes. */
  sessionId: string;
  /** A foursome member designated as scorer — the realistic scoring path. */
  scorerPlayerId: string;
  scorerSessionId: string;
  inviteToken: string;
  memberIds: string[];
  memberNames: string[];
}

/** Attach an arbitrary player's real session cookie to a browser context. */
export async function authAsSession(
  context: BrowserContext,
  sessionId: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'tournament_session',
      value: sessionId,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

/** Read the fixture handoff the seed wrote. Throws if the seed didn't run. */
export function readHandoff(): Handoff {
  return JSON.parse(readFileSync(resolve(TMP_DIR, 'handoff.json'), 'utf8')) as Handoff;
}

/** Attach the organizer's real session cookie to a browser context. */
export async function authAsOrganizer(
  context: BrowserContext,
  sessionId: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'tournament_session',
      value: sessionId,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

/**
 * Init script that makes `isInstalledPWA()` report TRUE by faking the
 * `(display-mode: standalone)` media query — score-entry gates real scoring
 * behind the installed-PWA check (score-entry.tsx:477), which a headless
 * browser tab would otherwise fail. Patches matchMedia BEFORE app scripts run.
 */
export const FAKE_STANDALONE_INIT = `
(() => {
  const real = window.matchMedia ? window.matchMedia.bind(window) : null;
  window.matchMedia = (query) => {
    if (typeof query === 'string' && query.includes('display-mode: standalone')) {
      return {
        matches: true, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent() { return false; },
      };
    }
    return real ? real(query) : { matches: false, media: query, addEventListener() {}, removeEventListener() {} };
  };
})();
`;
