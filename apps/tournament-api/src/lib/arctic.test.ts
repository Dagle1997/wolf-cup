import { describe, expect, test, vi } from 'vitest';

describe('arctic singleton (T1-6b)', () => {
  test('googleOAuth is constructable when env is loaded', async () => {
    // Module-load smoke: importing the module under test should not throw.
    // If Zod env parse failed OR the Google constructor threw, this import
    // would bubble the error. The test env supplies the two placeholder
    // keys via src/test-setup.ts.
    const mod = await import('./arctic.js');
    expect(mod.googleOAuth).toBeDefined();
    // Arctic's Google provider exposes createAuthorizationURL as a method;
    // asserting its presence is a cheap shape check that the singleton is
    // the class instance we expect, not e.g. `undefined` from a mis-import.
    expect(typeof mod.googleOAuth.createAuthorizationURL).toBe('function');
  });

  test('callback URL is normalized when PUBLIC_APP_URL has a trailing slash', async () => {
    // Seed a trailing-slash URL via a mocked env module, then dynamically
    // re-import arctic.ts so the module-load computation runs against the
    // mocked env. The full cleanup sequence (unmock + resetModules) lives
    // in a try/finally so a mid-test assertion failure never leaks the
    // mocked env to sibling tests.
    vi.resetModules();
    vi.doMock('./env.js', () => ({
      env: {
        NODE_ENV: 'test',
        DB_PATH: ':memory:',
        PORT: 3000,
        AUTH_COOKIE_DOMAIN: 'localhost',
        PUBLIC_APP_URL: 'http://localhost:5173/',
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
      },
    }));
    try {
      // Re-import arctic after the mock lands so the top-level
      // `new URL('/api/auth/google/callback', env.PUBLIC_APP_URL)` runs
      // against the trailing-slash PUBLIC_APP_URL.
      const arcticMod = await import('./arctic.js');
      // We can't read the callback URL off the Google instance directly
      // (arctic keeps it private), so we exercise it through
      // createAuthorizationURL — the redirect_uri ends up in the returned
      // URL's query string. The WHATWG URL constructor should have
      // collapsed the trailing slash: `http://localhost:5173/api/auth/...`
      // with exactly one slash between host and path.
      const authURL = arcticMod.googleOAuth.createAuthorizationURL(
        'state-value',
        'verifier-value',
        ['openid'],
      );
      const redirectURI = authURL.searchParams.get('redirect_uri');
      expect(redirectURI).toBe('http://localhost:5173/api/auth/google/callback');
      // Explicit negative assertion — no `//api` double-slash anywhere in
      // the path. Belt-and-suspenders against a future URL-constructor
      // behavior change.
      expect(redirectURI).not.toContain('//api');
    } finally {
      vi.doUnmock('./env.js');
      vi.resetModules();
    }
  });
});
