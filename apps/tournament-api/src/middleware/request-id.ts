import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '../lib/log.js';

/**
 * Request-id middleware (T1-7, D3-6).
 *
 * Assigns a unique id to every request, stores it + a request-scoped
 * child logger on Hono's context, and emits an outbound `X-Request-Id`
 * header so clients can correlate their request to our logs.
 *
 * Inbound `X-Request-Id` is accepted ONLY when it matches a safe ID
 * charset — rejecting malformed values avoids threading attacker-
 * controlled strings into log lines (defense-in-depth; pino's JSON
 * escaping already handles this safely, but the ingress boundary is
 * the cheapest place to filter).
 *
 * Mounted BEFORE the CSRF middleware in app.ts so every downstream
 * middleware (auth, route handlers) can read `c.get('requestId')` and
 * `c.get('logger')` without having to thread their own.
 *
 * Why a request-scoped child logger instead of passing `requestId` at
 * every call-site: pino's `logger.child({ requestId })` binds the id
 * to a new logger instance whose every subsequent call includes the
 * field. Call-sites use `c.get('logger').info({...})` and never have
 * to remember to pass the id — future routes cannot regress on this.
 */

// Safe ID charset: alphanumerics + `.`, `_`, `-`. Accepts UUID (hyphens
// legal), ULID (letters/digits), base64url-ish opaque ids. Rejects all
// control characters, `;`, `\n`, whitespace, and anything >128 chars.
const SAFE_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && SAFE_ID_RE.test(incoming) ? incoming : randomUUID();

  c.set('requestId', id);
  c.set('logger', logger.child({ requestId: id }));
  c.header('X-Request-Id', id);

  await next();
};
