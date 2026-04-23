import path from 'node:path';
import pino, { type Logger } from 'pino';
// pino-roll@4 ships no type declarations; the inline suppression below
// narrows the default import to `any` for the one call-site.
// @ts-expect-error — intentional: pino-roll ships no types
import pinoRoll from 'pino-roll';
import { env } from './env.js';
import { loggerOptions } from './log-options.js';

/**
 * Centralized structured JSON logger for tournament-api (T1-7, NFR-O1).
 *
 * Emits one JSON line per log call to BOTH stdout (docker log driver
 * captures this) AND a daily-rotated append-only file at
 * `${env.LOG_DIR}/tournament.YYYY-MM-DD.{n}.log`. The `{n}` segment is
 * pino-roll's rotation number (starts at 1, increments on size/day
 * rollover).
 *
 * Log shape:
 *   {"level":"info","ts":"2026-04-23T12:00:00.000Z","msg":"...", ...context}
 *
 * Request-scoped threading: the `requestIdMiddleware` creates a child
 * logger via `logger.child({ requestId })` and stores it on Hono's
 * context. Request handlers call `c.get('logger').info({...})` — the
 * requestId is bound automatically, no per-call-site threading.
 *
 * Import-time side effect: this module awaits pino-roll at top level to
 * open the file stream. tsconfig NodeNext + ESM + `"type": "module"` in
 * package.json supports top-level await. If the log directory is not
 * writable, the await rejects and the import fails — which is the
 * correct fail-fast behavior at container boot.
 *
 * The pure pino config lives in `log-options.ts` so tests can import it
 * without triggering the file-sink init.
 */

const fileStream = await pinoRoll({
  file: path.join(env.LOG_DIR, 'tournament'),
  frequency: 'daily',
  size: '100m',
  mkdir: true,
  extension: '.log',
  dateFormat: 'yyyy-MM-dd',
});

const streams = pino.multistream([
  { stream: process.stdout },
  { stream: fileStream },
]);

export const logger: Logger = pino(loggerOptions, streams);
