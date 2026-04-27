/**
 * T3-4 + T3-10 players router.
 *
 * **T3-4 (read-only GHIN proxy):**
 *   GET   /api/players/search?name=&state=
 *   GET   /api/players/lookup?ghin=<number>
 *
 * **T3-10 (player profile mutations):**
 *   POST  /api/players/me/ghin/link          — body discriminatedUnion: direct | search | pick
 *   PATCH /api/players/me/ghin               — sets players.ghin = NULL (idempotent)
 *   PATCH /api/players/me/manual-handicap    — sets players.manual_handicap_index
 *
 * All routes gated by `requireSession` (any authenticated player; not
 * organizer-only).
 *
 * GHIN client dependency: when credentials are unset (empty/undefined env
 * vars), the singleton is `null` and GHIN-touching endpoints (search,
 * lookup, link in `direct`/`search`/`pick` modes) return 503 service_unavailable.
 * The unlink + manual-handicap routes do NOT depend on GHIN.
 *
 * KNOWN LIMITATION (preserved from Wolf Cup source):
 * The `?state=` query param + the `state` body field on link `mode: 'search'`
 * are accepted but currently ignored — the upstream client unconditionally
 * hits state=WV. See PORTS.md.
 *
 * **T3-10 FR-E11 invariant**: at no point does GHIN being NULL OR a lookup
 * failing block any other surface. Linking is OPT-IN; the link endpoint
 * never mutates `players.ghin` on a 404/503/409 path.
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireSession } from '../middleware/require-session.js';
import { ghinClient } from '../lib/ghin-client.js';
import { db } from '../db/index.js';
import { players } from '../db/schema/index.js';

const TENANT_ID = 'guyan';
const SAVE_BODY_LIMIT_BYTES = 4 * 1024;
const SQLITE_UNIQUE_RAW_CODE = 2067;

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (matchUniqueSentinel(err)) return true;
  const cause = (err as { cause?: unknown }).cause;
  return matchUniqueSentinel(cause);
}

function matchUniqueSentinel(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; extendedCode?: unknown; rawCode?: unknown };
  return (
    e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.rawCode === SQLITE_UNIQUE_RAW_CODE
  );
}

export const playersRouter = new Hono();

const searchQuerySchema = z.object({
  name: z.string().trim().min(1),
  state: z.string().trim().optional(),
});

const lookupQuerySchema = z.object({
  ghin: z.coerce.number().int().positive(),
});

playersRouter.get('/search', requireSession, async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');

  const parseResult = searchQuerySchema.safeParse({
    name: c.req.query('name'),
    state: c.req.query('state'),
  });
  if (!parseResult.success) {
    return c.json(
      {
        error: 'bad_request',
        code: 'invalid_query',
        requestId,
        issues: parseResult.error.issues,
      },
      400,
    );
  }

  if (!ghinClient) {
    log.warn({
      event: 'ghin_call_failed',
      endpoint: 'search',
      reason: 'client_not_configured',
    });
    return c.json(
      { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
      503,
    );
  }

  try {
    const results = await ghinClient.searchByName(parseResult.data.name);
    return c.json({ results });
  } catch (err) {
    const e = err as { message?: unknown } | null;
    log.error({
      event: 'ghin_call_failed',
      endpoint: 'search',
      message: e?.message ?? null,
    });
    return c.json(
      { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
      503,
    );
  }
});

playersRouter.get('/lookup', requireSession, async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');

  const parseResult = lookupQuerySchema.safeParse({
    ghin: c.req.query('ghin'),
  });
  if (!parseResult.success) {
    return c.json(
      {
        error: 'bad_request',
        code: 'invalid_query',
        requestId,
        issues: parseResult.error.issues,
      },
      400,
    );
  }

  if (!ghinClient) {
    log.warn({
      event: 'ghin_call_failed',
      endpoint: 'lookup',
      reason: 'client_not_configured',
    });
    return c.json(
      { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
      503,
    );
  }

  const ghinNumber = parseResult.data.ghin;
  try {
    const result = await ghinClient.getHandicap(ghinNumber);
    return c.json({ ghinNumber, handicapIndex: result.handicapIndex });
  } catch (err) {
    const e = err as { message?: unknown } | null;
    const message = typeof e?.message === 'string' ? e.message : '';
    if (message === 'NOT_FOUND') {
      return c.json(
        { error: 'not_found', code: 'ghin_not_found', requestId },
        404,
      );
    }
    log.error({
      event: 'ghin_call_failed',
      endpoint: 'lookup',
      message,
    });
    return c.json(
      { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
      503,
    );
  }
});

// =====================================================================
// T3-10: profile mutations
// =====================================================================

const LinkGhinRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('direct'),
    ghinNumber: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('search'),
    lastName: z.string().trim().min(1),
    firstName: z.string().trim().min(1).optional(),
    state: z.string().trim().optional(),
  }),
  z.object({
    mode: z.literal('pick'),
    ghinNumber: z.number().int().positive(),
  }),
]);

const ManualHandicapRequestSchema = z.object({
  manualHandicapIndex: z.number().min(-10).max(54).nullable(),
});

/**
 * POST /api/players/me/ghin/link — see file header for the 3 modes + the
 * `result: 'linked' | 'multi-match'` response discriminator.
 */
playersRouter.post(
  '/me/ghin/link',
  requireSession,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const session = c.get('session');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parsed = LinkGhinRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parsed.error.issues,
        },
        400,
      );
    }
    const body = parsed.data;

    if (!ghinClient) {
      log.warn({
        event: 'ghin_call_failed',
        endpoint: 'link',
        reason: 'client_not_configured',
      });
      return c.json(
        { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
        503,
      );
    }

    // Helper: validate a candidate number via getHandicap, then bind it
    // to the session's player. Used by 'direct' and 'pick' modes, and by
    // 'search' when exactly one match is returned.
    async function bindGhin(ghinNumber: number): Promise<Response> {
      let handicapIndex: number | null;
      try {
        const result = await ghinClient!.getHandicap(ghinNumber);
        handicapIndex = result.handicapIndex;
      } catch (err) {
        const e = err as { message?: unknown } | null;
        const msg = typeof e?.message === 'string' ? e.message : '';
        if (msg === 'NOT_FOUND') {
          return c.json(
            { error: 'not_found', code: 'ghin_not_found', requestId },
            404,
          );
        }
        log.error({ event: 'ghin_call_failed', endpoint: 'link', message: msg });
        return c.json(
          { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
          503,
        );
      }

      try {
        await db
          .update(players)
          .set({ ghin: String(ghinNumber) })
          .where(
            and(
              eq(players.id, session.playerId),
              eq(players.tenantId, TENANT_ID),
            ),
          );
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          return c.json(
            { error: 'conflict', code: 'ghin_already_linked', requestId },
            409,
          );
        }
        const e = err as { message?: unknown } | null;
        log.error({
          event: 'ghin_link_failed',
          message: e?.message ?? null,
          ghinNumber,
        });
        return c.json(
          { error: 'internal', code: 'link_failed', requestId },
          500,
        );
      }

      log.info({
        event: 'ghin_linked',
        playerId: session.playerId,
        ghinNumber,
        mode: body.mode,
      });
      return c.json({
        result: 'linked' as const,
        ghinNumber,
        handicapIndex,
        requestId,
      });
    }

    if (body.mode === 'direct' || body.mode === 'pick') {
      return bindGhin(body.ghinNumber);
    }

    // body.mode === 'search'
    let matches: Awaited<ReturnType<typeof ghinClient.searchByName>>;
    try {
      matches = await ghinClient.searchByName(body.lastName, body.firstName);
    } catch (err) {
      const e = err as { message?: unknown } | null;
      log.error({
        event: 'ghin_call_failed',
        endpoint: 'link.search',
        message: e?.message ?? null,
      });
      return c.json(
        { error: 'service_unavailable', code: 'ghin_unavailable', requestId },
        503,
      );
    }

    if (matches.length === 0) {
      return c.json(
        { error: 'not_found', code: 'ghin_not_found', requestId },
        404,
      );
    }
    if (matches.length === 1) {
      return bindGhin(matches[0]!.ghinNumber);
    }
    return c.json({
      result: 'multi-match' as const,
      matches,
      requestId,
    });
  },
);

/**
 * PATCH /api/players/me/ghin — idempotent unlink. Sets players.ghin = NULL.
 */
playersRouter.patch(
  '/me/ghin',
  requireSession,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const session = c.get('session');

    await db
      .update(players)
      .set({ ghin: null })
      .where(
        and(eq(players.id, session.playerId), eq(players.tenantId, TENANT_ID)),
      );

    log.info({ event: 'ghin_unlinked', playerId: session.playerId });
    return c.json({ ghinNumber: null, requestId });
  },
);

/**
 * PATCH /api/players/me/manual-handicap — sets players.manual_handicap_index.
 * Independent of GHIN state per FR-E11.
 */
playersRouter.patch(
  '/me/manual-handicap',
  requireSession,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const session = c.get('session');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parsed = ManualHandicapRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parsed.error.issues,
        },
        400,
      );
    }

    await db
      .update(players)
      .set({ manualHandicapIndex: parsed.data.manualHandicapIndex })
      .where(
        and(eq(players.id, session.playerId), eq(players.tenantId, TENANT_ID)),
      );

    log.info({
      event: 'manual_handicap_updated',
      playerId: session.playerId,
      manualHandicapIndex: parsed.data.manualHandicapIndex,
    });
    return c.json({
      manualHandicapIndex: parsed.data.manualHandicapIndex,
      requestId,
    });
  },
);
