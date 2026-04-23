/**
 * Vitest `setupFiles` entry. Executes BEFORE any test file imports any
 * code-under-test — in particular, before `src/lib/env.ts` runs its
 * top-level `envSchema.parse(process.env)`.
 *
 * We assign values here instead of shipping a `.env.test` file so the
 * test config is self-contained and survives CI without extra dotenv
 * plumbing. If you need to override for a single suite, use vi.stubEnv
 * inside that suite instead — do NOT mutate process.env in place from
 * a test body (env.ts has already cached the parsed values by then).
 */
process.env['NODE_ENV'] = 'test';
process.env['DB_PATH'] = process.env['DB_PATH'] ?? ':memory:';
process.env['PORT'] = process.env['PORT'] ?? '3000';
process.env['AUTH_COOKIE_DOMAIN'] = process.env['AUTH_COOKIE_DOMAIN'] ?? 'localhost';
process.env['PUBLIC_APP_URL'] = process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173';
process.env['GOOGLE_OAUTH_CLIENT_ID'] =
  process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? 'test-client-id';
process.env['GOOGLE_OAUTH_CLIENT_SECRET'] =
  process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? 'test-client-secret';
