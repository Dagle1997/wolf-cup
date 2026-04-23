import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ArcticFetchError, OAuth2RequestError } from 'arctic';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// ---------------------------------------------------------------------
// Shared in-memory DB mock. Mirrors session.test.ts so schema lives in
// one place across the file. Must be declared BEFORE importing anything
// that uses db.
// ---------------------------------------------------------------------
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  return { client, db };
});

// ---------------------------------------------------------------------
// Mock the arctic singleton. We keep the REAL generateState /
// generateCodeVerifier + REAL error classes (imported directly from
// 'arctic' above) — only the Google-provider object is replaced so we
// can stub createAuthorizationURL + validateAuthorizationCode per test.
// ---------------------------------------------------------------------
const mockCreateAuthorizationURL = vi.fn();
const mockValidateAuthorizationCode = vi.fn();

vi.mock('../lib/arctic.js', () => ({
  googleOAuth: {
    createAuthorizationURL: mockCreateAuthorizationURL,
    validateAuthorizationCode: mockValidateAuthorizationCode,
  },
}));

// Imports AFTER the mocks so auth.ts and its dependencies pick them up.
const { db } = await import('../db/index.js');
const { players, oauthIdentities, sessions } = await import('../db/schema/index.js');
const { authRouter } = await import('./auth.js');
// T1-7: auth handlers read `requestId` + `logger` from ctx set by the
// global request-id middleware. Wrap the router under the middleware
// for tests so the production flow is mirrored.
const { requestIdMiddleware } = await import('../middleware/request-id.js');

// Build a test app that mounts the middleware and routes exactly like
// the production `app.ts` would. All existing tests call
// `testApp.request(...)` instead of `testApp.request(...)`.
const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/', authRouter);

const TEST_CLIENT_ID = 'test-client-id';
const PAST_EXP = Math.floor(Date.now() / 1000) - 60; // unused, reserved for future exp-failure tests
const FUTURE_EXP_SECS = () => Math.floor(Date.now() / 1000) + 3600;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reset mock state + DB rows between tests.
  mockCreateAuthorizationURL.mockReset();
  mockValidateAuthorizationCode.mockReset();
  await db.delete(sessions);
  await db.delete(oauthIdentities);
  await db.delete(players);

  // Default authorization-URL stub so GET /google tests have something
  // to redirect to. Individual tests may override.
  mockCreateAuthorizationURL.mockReturnValue(
    new URL(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&scope=openid&state=s&code_challenge=c',
    ),
  );
});

// ---------------------------------------------------------------------
// Helpers: build a JWT id_token with a controlled payload. We never
// verify the signature so the third segment is a placeholder.
// ---------------------------------------------------------------------
function makeIdToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function validIdToken(overrides: Record<string, unknown> = {}): string {
  return makeIdToken({
    iss: 'https://accounts.google.com',
    aud: TEST_CLIENT_ID,
    exp: FUTURE_EXP_SECS(),
    sub: 'google-sub-123',
    ...overrides,
  });
}

function tokensWithIdToken(idToken: string): { idToken: () => string } {
  // Minimal OAuth2Tokens shape — the handler only calls .idToken().
  return { idToken: () => idToken };
}

function cookieHeader(...pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Read all Set-Cookie headers off a Response. Node 19.7+ has
 * `headers.getSetCookie()`; older runtimes need the filter fallback.
 * We always use the fallback so the test is portable across CI images.
 */
function getSetCookies(res: Response): string[] {
  const all: string[] = [];
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'set-cookie') {
      // Some runtimes merge multiple Set-Cookie into one comma-joined
      // string. Since cookie attribute values can legitimately contain
      // commas (expiration dates), splitting isn't safe. If the runtime
      // exposes getSetCookie, prefer it.
      all.push(v);
    }
  });
  type WithGetSetCookie = { getSetCookie?: () => string[] };
  const h = res.headers as unknown as WithGetSetCookie;
  if (typeof h.getSetCookie === 'function') {
    return h.getSetCookie();
  }
  return all;
}

describe('auth router (T1-6b: Google OAuth)', () => {
  // AC #11 boundary — GET /status stays byte-identical.
  test('GET /status returns the T1-6a placeholder (unchanged)', async () => {
    const res = await testApp.request('/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: string; oauth: string };
    expect(body).toEqual({ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' });
  });

  // ---- /google sign-in entry -----------------------------------------

  test('GET /google sets both intermediate cookies with dev attributes', async () => {
    const res = await testApp.request('/google');
    expect(res.status).toBe(302);
    const cookies = getSetCookies(res);
    // Both intermediates must be present.
    const state = cookies.find((c) => c.startsWith('tournament_oauth_state='));
    const verifier = cookies.find((c) => c.startsWith('tournament_oauth_code_verifier='));
    expect(state).toBeDefined();
    expect(verifier).toBeDefined();
    // Dev attributes — SameSite=Lax, 10 min TTL, no Secure, no Domain.
    for (const c of [state!, verifier!]) {
      expect(c).toContain('HttpOnly');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/');
      expect(c).toContain('Max-Age=600');
      expect(c).not.toContain('Secure');
      expect(c).not.toContain('Domain=');
    }
  });

  test('GET /google redirects 302 to a URL starting with https://accounts.google.com/', async () => {
    const res = await testApp.request('/google');
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://accounts.google.com/')).toBe(true);
  });

  // ---- /google/callback error branches -------------------------------

  test('GET /google/callback?error=access_denied → 302 /auth/declined + clear-cookies', async () => {
    const res = await testApp.request('/google/callback?error=access_denied');
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.endsWith('/auth/declined')).toBe(true);
    const cookies = getSetCookies(res);
    // Both intermediates cleared.
    expect(cookies.some((c) => c.startsWith('tournament_oauth_state=') && c.includes('Max-Age=0'))).toBe(
      true,
    );
    expect(
      cookies.some(
        (c) => c.startsWith('tournament_oauth_code_verifier=') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  test('GET /google/callback?error=server_error → 503 auth_provider_outage', async () => {
    const res = await testApp.request('/google/callback?error=server_error');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('auth_provider_outage');
  });

  test('GET /google/callback?error=temporarily_unavailable → 503 auth_provider_outage', async () => {
    const res = await testApp.request('/google/callback?error=temporarily_unavailable');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('auth_provider_outage');
  });

  test('GET /google/callback?error=invalid_request → 500 oauth_provider_error', async () => {
    const res = await testApp.request('/google/callback?error=invalid_request');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_provider_error');
  });

  test('GET /google/callback with no code and no error → 400 oauth_missing_params', async () => {
    const res = await testApp.request('/google/callback');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_missing_params');
  });

  test('GET /google/callback with missing state cookie → 400 oauth_cookies_missing', async () => {
    const res = await testApp.request('/google/callback?code=C&state=S');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_cookies_missing');
  });

  test('GET /google/callback with state mismatch → 400 oauth_state_mismatch + clear-cookies', async () => {
    const res = await testApp.request(
      '/google/callback?code=C&state=MISMATCH',
      {
        headers: {
          cookie: cookieHeader(
            ['tournament_oauth_state', 'ORIGINAL'],
            ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
          ),
        },
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_state_mismatch');
    const cookies = getSetCookies(res);
    expect(cookies.some((c) => c.startsWith('tournament_oauth_state=') && c.includes('Max-Age=0'))).toBe(
      true,
    );
    expect(
      cookies.some(
        (c) => c.startsWith('tournament_oauth_code_verifier=') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  test('GET /google/callback with ArcticFetchError → 503 auth_provider_outage', async () => {
    mockValidateAuthorizationCode.mockRejectedValueOnce(new ArcticFetchError(new Error('econnreset')));
    const res = await testApp.request('/google/callback?code=C&state=S', {
      headers: {
        cookie: cookieHeader(
          ['tournament_oauth_state', 'S'],
          ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
        ),
      },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('auth_provider_outage');
  });

  test('GET /google/callback with OAuth2RequestError → 400 oauth_exchange_failed', async () => {
    mockValidateAuthorizationCode.mockRejectedValueOnce(
      new OAuth2RequestError('invalid_grant', 'bad code', null, null),
    );
    const res = await testApp.request('/google/callback?code=C&state=S', {
      headers: {
        cookie: cookieHeader(
          ['tournament_oauth_state', 'S'],
          ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
        ),
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_exchange_failed');
    // Token-exchange failures clear the intermediates so a stale state
    // cookie can't haunt the next sign-in attempt.
    const cookies = getSetCookies(res);
    expect(
      cookies.some((c) => c.startsWith('tournament_oauth_state=') && c.includes('Max-Age=0')),
    ).toBe(true);
  });

  test('GET /google/callback with unknown validateAuthorizationCode error → 503 + log', async () => {
    // A plain `Error` is neither ArcticFetchError nor OAuth2RequestError,
    // so the handler's "unknown shape" branch fires: 503 + logger.error
    // with event: 'oauth_unknown_error'.
    //
    // Post-T1-7 the log routes through the pino singleton → stdout. Spy
    // on process.stdout.write and grep for the event marker. The file
    // sink is also written, but stdout is the primary destination and
    // doesn't require a tmpdir dance for this assertion.
    mockValidateAuthorizationCode.mockRejectedValueOnce(new Error('unexpected upstream shape'));
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const res = await testApp.request('/google/callback?code=C&state=S', {
        headers: {
          cookie: cookieHeader(
            ['tournament_oauth_state', 'S'],
            ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
          ),
        },
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('auth_provider_outage');
      // Verify the unknown-error log fired.
      const logged = stdoutSpy.mock.calls.some((args) => {
        const raw = args[0];
        const s =
          typeof raw === 'string'
            ? raw
            : raw instanceof Uint8Array
              ? Buffer.from(raw).toString('utf-8')
              : '';
        return s.includes('oauth_unknown_error');
      });
      expect(logged).toBe(true);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  test('GET /google/callback with id_token missing sub → 502 oauth_invalid_id_token', async () => {
    mockValidateAuthorizationCode.mockResolvedValueOnce(
      tokensWithIdToken(
        makeIdToken({
          iss: 'https://accounts.google.com',
          aud: TEST_CLIENT_ID,
          exp: FUTURE_EXP_SECS(),
          // deliberately no sub
        }),
      ),
    );
    const res = await testApp.request('/google/callback?code=C&state=S', {
      headers: {
        cookie: cookieHeader(
          ['tournament_oauth_state', 'S'],
          ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
        ),
      },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_invalid_id_token');
  });

  test('GET /google/callback with id_token wrong aud → 502 oauth_invalid_id_token', async () => {
    mockValidateAuthorizationCode.mockResolvedValueOnce(
      tokensWithIdToken(validIdToken({ aud: 'some-other-client-id' })),
    );
    const res = await testApp.request('/google/callback?code=C&state=S', {
      headers: {
        cookie: cookieHeader(
          ['tournament_oauth_state', 'S'],
          ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
        ),
      },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('oauth_invalid_id_token');
  });

  // ---- /google/callback happy paths ----------------------------------

  test('GET /google/callback happy path, new user: 1 player + 1 oauth_identity + 1 session + 3 Set-Cookie', async () => {
    const sub = 'google-sub-new-user-1';
    mockValidateAuthorizationCode.mockResolvedValueOnce(
      tokensWithIdToken(validIdToken({ sub })),
    );
    const res = await testApp.request('/google/callback?code=C&state=S', {
      headers: {
        cookie: cookieHeader(
          ['tournament_oauth_state', 'S'],
          ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
        ),
        'user-agent': 'Mozilla/5.0 Vitest',
        'x-forwarded-for': '127.0.0.1',
      },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBeTruthy();

    // 3 Set-Cookie headers: session + 2 clears.
    const cookies = getSetCookies(res);
    const session = cookies.find((c) => c.startsWith('tournament_session='));
    const stateClear = cookies.find(
      (c) => c.startsWith('tournament_oauth_state=') && c.includes('Max-Age=0'),
    );
    const verifierClear = cookies.find(
      (c) => c.startsWith('tournament_oauth_code_verifier=') && c.includes('Max-Age=0'),
    );
    expect(session).toBeDefined();
    expect(stateClear).toBeDefined();
    expect(verifierClear).toBeDefined();

    // Session cookie carries Strict (not Lax).
    expect(session!).toContain('SameSite=Strict');

    // DB shape: exactly 1 player + 1 oauth_identity + 1 session.
    const playerRows = await db.select().from(players);
    expect(playerRows).toHaveLength(1);
    const oauthRows = await db
      .select()
      .from(oauthIdentities)
      .where(eq(oauthIdentities.providerSub, sub));
    expect(oauthRows).toHaveLength(1);
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(oauthRows[0]!.playerId).toBe(playerRows[0]!.id);
    expect(sessionRows[0]!.playerId).toBe(playerRows[0]!.id);
  });

  test('GET /google/callback happy path, returning user: 0 new player/oauth_identity, 1 new session', async () => {
    // Pre-seed a returning user.
    const existingPlayerId = 'existing-player-1';
    const sub = 'google-sub-returning-1';
    const now = Date.now();
    await db.insert(players).values({
      id: existingPlayerId,
      isOrganizer: false,
      createdAt: now - 1000,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(oauthIdentities).values({
      id: 'existing-oauth-1',
      provider: 'google',
      providerSub: sub,
      playerId: existingPlayerId,
      createdAt: now - 1000,
      contextId: 'league:guyan-wolf-cup-friday',
    });

    mockValidateAuthorizationCode.mockResolvedValueOnce(
      tokensWithIdToken(validIdToken({ sub })),
    );

    const res = await testApp.request('/google/callback?code=C&state=S', {
      headers: {
        cookie: cookieHeader(
          ['tournament_oauth_state', 'S'],
          ['tournament_oauth_code_verifier', 'VERIFIER1234567890'],
        ),
      },
    });
    expect(res.status).toBe(302);

    // Still 1 player + 1 oauth_identity (nothing new).
    const playerRows = await db.select().from(players);
    expect(playerRows).toHaveLength(1);
    const oauthRows = await db.select().from(oauthIdentities);
    expect(oauthRows).toHaveLength(1);

    // 1 new session bound to the existing player.
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]!.playerId).toBe(existingPlayerId);
  });

  test('libsql UNIQUE-violation error shape matches isUniqueConstraintError predicate (AC #9 verify-at-impl step)', async () => {
    // The handler's UNIQUE-retry path (AC #9 steps 4-5) depends on the
    // exact shape of the error libsql throws on a UNIQUE constraint
    // violation. The spec explicitly calls for the dev agent to verify
    // the shape at impl time rather than trusting the spec's recorded
    // strings — libsql's error surface has shifted across versions.
    //
    // This test exercises that: insert one row, then attempt a
    // conflicting second insert, and assert the thrown error carries at
    // LEAST one of the sentinels isUniqueConstraintError looks for.
    //
    // Note: under SQLite's write-serialization, a true intra-request
    // race (outer SELECT miss → concurrent insert → UNIQUE on OUR
    // insert) cannot be reliably simulated in a single-process test
    // without injection points; our in-process concurrency test hit
    // SQLITE_LOCKED (rawCode 262), not SQLITE_CONSTRAINT_UNIQUE, since
    // SQLite serializes writers rather than letting them interleave.
    // In production, libsql's distributed backend CAN surface real
    // UNIQUE violations; this error-shape test is the artifact that
    // pins the predicate.
    const sub = 'google-sub-dup-insert';
    const now = Date.now();
    await db.insert(players).values({
      id: 'player-dup-1',
      isOrganizer: false,
      createdAt: now,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(oauthIdentities).values({
      id: 'oi-dup-1',
      provider: 'google',
      providerSub: sub,
      playerId: 'player-dup-1',
      createdAt: now,
      contextId: 'league:guyan-wolf-cup-friday',
    });

    // Attempt a duplicate insert into oauth_identities with the same
    // (tenant_id, provider, provider_sub) tuple — should hit the composite
    // UNIQUE index and throw.
    let caught: unknown = null;
    try {
      await db.insert(oauthIdentities).values({
        id: 'oi-dup-2',
        provider: 'google',
        providerSub: sub,
        playerId: 'player-dup-1',
        createdAt: now,
        contextId: 'league:guyan-wolf-cup-friday',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();

    // Drizzle 0.45+ wraps the driver error in a DrizzleQueryError and
    // stashes the real LibsqlError on `.cause`. The handler's predicate
    // must unwrap one level to find the UNIQUE sentinels — this test
    // pins that contract.
    const cause = (caught as { cause?: unknown }).cause;
    expect(cause).toBeTruthy();
    const causeAsErr = cause as {
      name?: unknown;
      code?: unknown;
      extendedCode?: unknown;
      rawCode?: unknown;
    };
    // Cause is a LibsqlError.
    expect(causeAsErr.name).toBe('LibsqlError');

    // Pin the EXACT shape observed in libsql 0.17 so future driver
    // upgrades that drop or rename any sentinel surface as a test
    // failure rather than a silent production race-bind regression.
    expect(causeAsErr.code).toBe('SQLITE_CONSTRAINT');
    expect(causeAsErr.extendedCode).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(causeAsErr.rawCode).toBe(2067);

    // Also verify the handler's own predicate handles this shape.
    // Re-import to avoid any module-graph staleness from other tests in
    // this file (which do vi.resetModules for the prod-cookie test).
    const { isUniqueConstraintErrorForTests } = await import('./auth.js');
    expect(isUniqueConstraintErrorForTests(caught)).toBe(true);

    // Future-proofing assertion: the predicate must also accept a
    // synthesized error that carries ONLY the generic `SQLITE_CONSTRAINT`
    // code (no extendedCode, no rawCode) — the shape codex round-1
    // flagged as a future-libsql risk. The fallback in
    // checkUniqueSentinels handles this; this assertion locks it in.
    const generic = { name: 'LibsqlError', code: 'SQLITE_CONSTRAINT' };
    expect(isUniqueConstraintErrorForTests(generic)).toBe(true);
    // And the predicate must also unwrap one .cause level for the
    // generic shape — same path the real drizzle wrapping takes.
    const wrappedGeneric = { name: 'Error', cause: generic };
    expect(isUniqueConstraintErrorForTests(wrappedGeneric)).toBe(true);
    // Negative: a non-constraint error should NOT match.
    expect(
      isUniqueConstraintErrorForTests({ name: 'LibsqlError', code: 'SQLITE_BUSY' }),
    ).toBe(false);
  });

  test('GET /google under NODE_ENV=production emits Secure + Domain on both intermediates', async () => {
    vi.resetModules();
    vi.doMock('../lib/env.js', () => ({
      env: {
        NODE_ENV: 'production',
        DB_PATH: ':memory:',
        PORT: 3000,
        AUTH_COOKIE_DOMAIN: 'tournament.dagle.cloud',
        PUBLIC_APP_URL: 'https://tournament.dagle.cloud',
        GOOGLE_OAUTH_CLIENT_ID: TEST_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
      },
    }));
    // Re-mock arctic against the same reset module graph so the re-imported
    // auth router still uses our stub rather than constructing a real Google
    // client with now-prod env values.
    vi.doMock('../lib/arctic.js', () => ({
      googleOAuth: {
        createAuthorizationURL: () =>
          new URL('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
        validateAuthorizationCode: () => {
          throw new Error('unused in this test');
        },
      },
    }));
    try {
      const { authRouter: prodRouter } = await import('./auth.js');
      const res = await prodRouter.request('/google');
      const cookies = getSetCookies(res);
      const state = cookies.find((c) => c.startsWith('tournament_oauth_state='));
      const verifier = cookies.find((c) => c.startsWith('tournament_oauth_code_verifier='));
      expect(state).toBeDefined();
      expect(verifier).toBeDefined();
      for (const c of [state!, verifier!]) {
        expect(c).toContain('Secure');
        expect(c).toContain('Domain=tournament.dagle.cloud');
        expect(c).toContain('SameSite=Lax');
      }
    } finally {
      vi.doUnmock('../lib/env.js');
      vi.doUnmock('../lib/arctic.js');
      vi.resetModules();
    }
  });
});

// Quiet a lint warning on PAST_EXP — reserved for a future explicit
// "expired id_token" test if signature-verification ever lands.
void PAST_EXP;
