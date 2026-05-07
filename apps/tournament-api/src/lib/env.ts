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
 * `ANTHROPIC_API_KEY` is supplied via docker-compose in production (bare
 * `${ANTHROPIC_API_KEY}` reference — no compose fallback so a missing
 * VPS `.env` entry fails fast at boot). In local dev it comes from
 * `apps/tournament-api/.env`; in tests it's injected by `src/test-setup.ts`
 * with a non-secret placeholder. Required / no default / min(1) — same
 * fail-fast posture as GOOGLE_OAUTH_*.
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
  // Anthropic Vision API key (T2-3). Required for the scorecard-PDF parser
  // route. Same fail-fast posture as GOOGLE_OAUTH_* — missing value on the
  // VPS crashes the container at boot rather than silently 503-ing every
  // parse request with an opaque auth error from Anthropic.
  ANTHROPIC_API_KEY: z.string().min(1),
  // Logging (T1-7). LOG_LEVEL defaults to 'info' which is what prod wants;
  // dev can override via .env. LOG_DIR is optional at the schema level and
  // resolved below by the post-parse transform — that way env.LOG_DIR is
  // always a non-optional string for consumers (path.join safety), and
  // production gets '/app/data/logs' (existing tournament_sqlite_data
  // volume) without needing docker-compose to set it explicitly.
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  // `.refine(non-whitespace)` mirrors DB_PATH's guard — a compose value
  // of `"   "` or `""` would otherwise resolve to a whitespace path
  // rather than triggering the NODE_ENV-sensitive default below.
  LOG_DIR: z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, 'LOG_DIR must not be whitespace-only')
    .optional(),
  // GHIN credentials (T3-4). OPTIONAL — non-essential integration. Both
  // missing/undefined OR empty string evaluate as "credentials not set",
  // and the GHIN client singleton becomes `null`. Routes that depend on
  // it (/api/players/search + /api/players/lookup) return 503
  // service_unavailable. Mirrors Wolf Cup's `process.env['GHIN_USERNAME'] &&
  // process.env['GHIN_PASSWORD']` truthy-check at apps/api/src/lib/ghin-client.ts:105-106.
  // Differs from AUTH_COOKIE_DOMAIN / PUBLIC_APP_URL / ANTHROPIC_API_KEY
  // (REQUIRED, fail-fast) because GHIN can be unset without breaking the
  // app's core flow — the player can fall back to manual handicap entry.
  GHIN_USERNAME: z.string().optional(),
  GHIN_PASSWORD: z.string().optional(),
  // Cloudflare R2 credentials (T7-4 photo gallery). OPTIONAL — non-essential
  // integration, mirrors the GHIN pattern. When any of the four is missing
  // or empty, `lib/r2-client.ts` evaluates `r2Configured === false` and the
  // upload route returns 503 storage_not_configured; the list route returns
  // a graceful empty `{ groups: [] }`. Production reads these from
  // `/opt/wolf-cup/.env` (already present for Wolf Cup gallery use); the
  // tournament-api service block in docker-compose.yml passes them through.
  // Architecture D5-10 dictates the SAME bucket as Wolf Cup with a
  // 'tournament/events/{eventId}/' key prefix.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
});

// Post-parse transform resolves LOG_DIR based on NODE_ENV. The result has
// LOG_DIR as a guaranteed string — downstream `path.join(env.LOG_DIR, ...)`
// is safe with no undefined branch.
const envWithDefaults = envSchema.transform((parsed) => ({
  ...parsed,
  LOG_DIR:
    parsed.LOG_DIR ?? (parsed.NODE_ENV === 'production' ? '/app/data/logs' : './data/logs'),
}));

export type Env = z.infer<typeof envWithDefaults>;

// Parse at module load. Throws on invalid config — fail-fast at boot.
export const env: Env = envWithDefaults.parse(process.env);

/**
 * Trip-1 kill switch for the press feature. Read at call time (not cached at
 * module load) so tests can flip it via `vi.stubEnv`. Set
 * `TOURNAMENT_PRESSES_DISABLED=true` in the VPS `.env` to disable both
 * auto-press (server-side, runs inside the score-commit transaction) AND
 * manual press routes (`POST/DELETE /api/rounds/:roundId/presses`).
 *
 * Why a runtime helper instead of a parsed-config field: the rest of `env`
 * is parsed once at boot and cached. Tests stub via `vi.stubEnv` AFTER
 * `env.ts` has already parsed, so a cached field would be unreachable from
 * tests without re-importing the module. This helper keeps `process.env`
 * reads centralized in env.ts (per the module's stated policy) while
 * staying test-friendly.
 *
 * Trip-day reason: team_press_log is foursome-blind in v1 — UNIQUE is
 * `(round_id, team, start_hole, trigger_type)` with no foursome dimension,
 * so a press fired in foursome 2 collides with foursome 1's press at the
 * same hole/team and gets silently dropped (or cross-suppresses). v1.5
 * adds `foursome_number` to the schema + migrates the UNIQUE; until then
 * the safe trip-day posture is to disable the feature globally.
 */
export function pressesDisabled(): boolean {
  const v = process.env['TOURNAMENT_PRESSES_DISABLED'];
  return v === 'true' || v === '1';
}
