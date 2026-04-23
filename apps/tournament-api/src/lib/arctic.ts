import { Google } from 'arctic';
import { env } from './env.js';

/**
 * Singleton `arctic` Google OAuth client.
 *
 * The callback URL is built via the WHATWG `URL` constructor rather than
 * string concatenation. This is load-bearing: Google's OAuth console
 * requires an EXACT redirect_uri match against the registered value. If
 * `PUBLIC_APP_URL` has a trailing slash (e.g. `https://tournament.dagle.cloud/`)
 * and we concatenate `/api/auth/google/callback`, we get `...//api/auth/...`
 * — double slash, different URI, OAuth registration mismatch, `invalid_grant`
 * returned by Google. `new URL(path, base)` normalizes every trailing-slash
 * / double-slash / path-component edge case in one call.
 *
 * Exported as a const singleton. Keeping this file tiny and pure makes
 * it trivial to mock in `auth.test.ts` via `vi.mock('../lib/arctic.js', ...)`.
 */
const callbackURL = new URL('/api/auth/google/callback', env.PUBLIC_APP_URL).toString();

export const googleOAuth = new Google(
  env.GOOGLE_OAUTH_CLIENT_ID,
  env.GOOGLE_OAUTH_CLIENT_SECRET,
  callbackURL,
);
