import type { LoggerOptions } from 'pino';
import { env } from './env.js';

/**
 * Pure pino configuration — no side effects, no file handles, no
 * process-level I/O. Split out from `log.ts` (which does top-level
 * `await pinoRoll(...)` to open the daily-rotated file stream) so that
 * tests and any caller who only needs the config shape can import
 * without triggering the file-sink initialization.
 *
 * Consumers:
 *   - `log.ts` — passes this to `pino(loggerOptions, multistream)` to
 *     build the production singleton.
 *   - `log.test.ts` — builds an in-memory logger with the same config
 *     against a controlled Writable stream to assert the JSON shape.
 */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  // ISO-8601 timestamp under the key `ts` — replaces pino's default
  // unix-ms integer. Epic AC calls out `{ ts: <ISO> }` shape.
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  // Emit `level: 'info'` instead of pino's default numeric level (30).
  // Operators grep by string; the numeric-level lookup table is noise.
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Drop pino's default `pid` and `hostname` — noise at our scale and
  // leaks container metadata into logs we may want to export. Pino's
  // type for `base` is `{[key: string]: any} | null`; `null` is the
  // documented sentinel to suppress base fields.
  base: null,
};
