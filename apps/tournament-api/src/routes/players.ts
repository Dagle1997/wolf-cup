/**
 * T3-4 players router. Two read-only GHIN proxy endpoints:
 *   GET /api/players/search?name=&state=
 *   GET /api/players/lookup?ghin=<number>
 *
 * Both gated by `requireSession` (any authenticated player can use these;
 * not organizer-only) per epic AC #3.
 *
 * Both depend on the ported GhinDirectClient singleton at src/lib/ghin-client.ts.
 * When GHIN credentials are unset (empty/undefined env vars), the singleton
 * is `null` and both endpoints return 503 service_unavailable.
 *
 * KNOWN LIMITATION (preserved from Wolf Cup source):
 * The `?state=` query param is accepted but currently ignored — the
 * upstream client unconditionally hits state=WV. See PORTS.md.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession } from '../middleware/require-session.js';
import { ghinClient } from '../lib/ghin-client.js';

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
