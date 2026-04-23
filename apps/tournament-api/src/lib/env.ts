import { z } from 'zod';

/**
 * Centralized, validated environment access for tournament-api.
 *
 * All `process.env` reads go through this module — nowhere else in
 * tournament-api should touch `process.env` directly. Zod parse runs at
 * module load time; invalid config throws immediately so the container
 * fails fast at boot with a clear error rather than shipping with a
 * subtly-wrong default (e.g., a production cookie scoped to `localhost`).
 *
 * Required-values plumbing across execution contexts:
 *
 *   Production (VPS):
 *     Supplied by docker-compose.yml via bare `${VAR}` references with NO
 *     compose-level fallback — a missing value on the VPS results in an
 *     empty string, which Zod rejects, which crashes the container at
 *     boot with a clear "Invalid environment" error.
 *
 *   Local dev (`pnpm -F @tournament/api dev`):
 *     Josh creates `apps/tournament-api/.env` with at minimum
 *     NODE_ENV=development, DB_PATH=./data/tournament.db,
 *     AUTH_COOKIE_DOMAIN=localhost, PUBLIC_APP_URL=http://localhost:5173.
 *     The dev script uses `node --env-file=.env`.
 *
 *   Tests (`pnpm -F @tournament/api test`):
 *     Vitest setupFiles injects env values before any test code imports
 *     this module. See src/test-setup.ts.
 *
 * Why AUTH_COOKIE_DOMAIN and PUBLIC_APP_URL are REQUIRED with no defaults:
 * silent misconfiguration is worse than failing to start. A default like
 * `http://localhost:5173` accidentally shipped to production would break
 * CSRF origin checks and scope cookies to the wrong host.
 *
 * Note on `ADMIN_SESSION_SECRET`: intentionally NOT included. Session
 * cookie value IS the opaque server-side-stored `session_id`; no HMAC
 * signing is used or needed. Reserved for a hypothetical future signed-
 * cookie feature if one ever exists.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  // `.min(1)` + `.refine(non-whitespace)` so a compose passing "" or "   "
  // (missing .env var; stripped/whitespace-only) fails fast rather than
  // silently defaulting to the process's cwd or the string "   ".
  DB_PATH: z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, 'DB_PATH must not be whitespace-only'),
  // Accept a non-empty string, then coerce. Without the preprocess guard,
  // `z.coerce.number().default(3000)` would treat an empty string as 0
  // (Number('') === 0) rather than falling back to 3000.
  PORT: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.coerce.number().int().positive().default(3000),
    ),
  // Constrain to something that looks like a cookie Domain attribute —
  // a DNS-ish hostname, no scheme, no path, no whitespace, no control chars,
  // no attribute-injection characters (`;`, newlines). Defense-in-depth
  // against a misconfigured `.env.production` injecting extra Set-Cookie
  // attributes through string concatenation in sessionCookieHeader.
  //
  // Underscores deliberately excluded: RFC 1035 disallows `_` in hostnames,
  // and several browsers (notably Safari and older Chromium) drop cookies
  // whose Domain contains `_`. Matches Wolf Cup's `wolf.dagle.cloud` and
  // the planned `tournament.dagle.cloud` patterns.
  AUTH_COOKIE_DOMAIN: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z0-9.-]+$/,
      'AUTH_COOKIE_DOMAIN must be a bare hostname (letters, digits, dots, hyphens only — no underscores, no scheme, no path)',
    ),
  PUBLIC_APP_URL: z.string().url(),
  // Google OAuth client credentials (T1-6b). Required, no defaults —
  // same fail-fast posture as AUTH_COOKIE_DOMAIN / PUBLIC_APP_URL. Missing
  // values on the VPS crash the container at boot rather than silently
  // shipping with a broken auth flow.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

// Parse at module load. Throws on invalid config — fail-fast at boot.
export const env: Env = envSchema.parse(process.env);
