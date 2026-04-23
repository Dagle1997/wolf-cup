import { describe, expect, test, vi } from 'vitest';
import {
  oauthFlowCookieHeader,
  oauthFlowClearHeader,
  STATE_COOKIE_NAME,
  VERIFIER_COOKIE_NAME,
} from './oauth-cookies.js';

describe('oauth flow cookies (T1-6b)', () => {
  const sampleState = 'abc123_state-value.with~chars';
  const samplePkceVerifier = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM_FYyQ1';

  test('set header for state cookie emits dev attributes (no Secure, no Domain)', () => {
    const header = oauthFlowCookieHeader(STATE_COOKIE_NAME, sampleState);
    expect(header).toContain(`${STATE_COOKIE_NAME}=${sampleState}`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=600');
    expect(header).not.toContain('Secure');
    expect(header).not.toContain('Domain=');
  });

  test('set header for verifier cookie accepts PKCE charset (. ~)', () => {
    // PKCE verifier per RFC 7636 can include `.` and `~`. The stricter
    // base64url regex used by sessionCookieHeader would reject these,
    // so this test guards against accidentally tightening our regex.
    const header = oauthFlowCookieHeader(VERIFIER_COOKIE_NAME, samplePkceVerifier);
    expect(header).toContain(`${VERIFIER_COOKIE_NAME}=${samplePkceVerifier}`);
    expect(header).toContain('SameSite=Lax');
  });

  test('clear header emits Max-Age=0 with the same base attributes as set', () => {
    const header = oauthFlowClearHeader(STATE_COOKIE_NAME);
    expect(header).toContain(`${STATE_COOKIE_NAME}=`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=0');
  });

  test('throws on header-injection-shaped values', () => {
    expect(() =>
      oauthFlowCookieHeader(STATE_COOKIE_NAME, 'abc; Path=/evil'),
    ).toThrow();
    expect(() => oauthFlowCookieHeader(STATE_COOKIE_NAME, 'has space')).toThrow();
    expect(() => oauthFlowCookieHeader(STATE_COOKIE_NAME, 'has\nnewline')).toThrow();
    // Too short → reject. 16-char minimum is defense-in-depth against
    // a handler accidentally passing an empty or truncated state.
    expect(() => oauthFlowCookieHeader(STATE_COOKIE_NAME, 'short')).toThrow();
    // Too long → reject. Guards against unbounded header growth.
    expect(() =>
      oauthFlowCookieHeader(STATE_COOKIE_NAME, 'a'.repeat(257)),
    ).toThrow();
  });

  test('set + clear under NODE_ENV=production emit Secure + Domain with attribute parity', async () => {
    // env.ts parses process.env at module load; to test the production
    // branch we mock env.js before re-importing oauth-cookies.ts.
    vi.resetModules();
    vi.doMock('./env.js', () => ({
      env: {
        NODE_ENV: 'production',
        DB_PATH: 'unused',
        PORT: 3000,
        AUTH_COOKIE_DOMAIN: 'tournament.dagle.cloud',
        PUBLIC_APP_URL: 'https://tournament.dagle.cloud',
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
      },
    }));
    try {
      const {
        oauthFlowCookieHeader: prodSet,
        oauthFlowClearHeader: prodClear,
      } = await import('./oauth-cookies.js');
      const setHeader = prodSet(STATE_COOKIE_NAME, sampleState);
      const clearHeader = prodClear(STATE_COOKIE_NAME);
      // Prod SET header has both Secure and Domain.
      expect(setHeader).toContain('Secure');
      expect(setHeader).toContain('Domain=tournament.dagle.cloud');
      // Prod CLEAR header MUST carry the exact same attributes — browsers
      // only remove a cookie when every attribute matches the stored one.
      expect(clearHeader).toContain('Secure');
      expect(clearHeader).toContain('Domain=tournament.dagle.cloud');
      expect(clearHeader).toContain('HttpOnly');
      expect(clearHeader).toContain('SameSite=Lax');
      expect(clearHeader).toContain('Path=/');
      expect(clearHeader).toContain('Max-Age=0');
    } finally {
      vi.doUnmock('./env.js');
      vi.resetModules();
    }
  });
});
