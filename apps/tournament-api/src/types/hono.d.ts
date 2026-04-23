import type { Logger } from 'pino';

/**
 * Hono Variables augmentation. Declared in a dedicated `.d.ts` file so
 * TS picks it up project-wide via `tsconfig.app.json`'s `include: ["src"]`,
 * without requiring any consumer to import a specific file for its
 * side-effect augmentation.
 *
 * Inline `declare module 'hono'` in a `.ts` file works only when that
 * file is in the import graph of the consumer — which is fragile and was
 * flagged by codex round-1. The `.d.ts` approach is safer: TS loads all
 * .d.ts files in the include glob unconditionally.
 *
 * Populated by:
 *   - `src/middleware/request-id.ts` → sets `c.set('requestId', ...)` +
 *     `c.set('logger', logger.child({ requestId }))` on every request.
 *   - `src/middleware/require-session.ts` → sets `c.set('session', ...)`
 *     + `c.set('player', ...)` after a successful session validate.
 */
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    logger: Logger;
    session: {
      sessionId: string;
      playerId: string;
    };
    player: {
      id: string;
      isOrganizer: boolean;
    };
  }
}

export {};
