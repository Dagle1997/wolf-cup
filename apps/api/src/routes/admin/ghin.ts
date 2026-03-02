import { Hono } from 'hono';
import { ghinClient } from '../../lib/ghin-client.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /ghin/search?last_name=...&first_name=... — search golfers by name
// ---------------------------------------------------------------------------

app.get('/ghin/search', adminAuthMiddleware, async (c) => {
  const lastName = c.req.query('last_name')?.trim() ?? '';
  const firstName = c.req.query('first_name')?.trim();

  if (!lastName) {
    return c.json({ error: 'last_name is required', code: 'VALIDATION_ERROR' }, 400);
  }

  if (!ghinClient) {
    return c.json(
      { error: 'GHIN credentials not configured', code: 'GHIN_NOT_CONFIGURED' },
      503,
    );
  }

  try {
    const results = await ghinClient.searchByName(lastName, firstName);
    return c.json({ results }, 200);
  } catch (err) {
    const code = (err as Error).message;
    if (code === 'GHIN_AUTH_FAILED') {
      return c.json({ error: 'GHIN credentials invalid', code: 'GHIN_AUTH_FAILED' }, 503);
    }
    return c.json({ error: 'GHIN API unavailable', code: 'GHIN_UNAVAILABLE' }, 503);
  }
});

// ---------------------------------------------------------------------------
// GET /ghin/:ghinNumber — look up current handicap index from GHIN
// ---------------------------------------------------------------------------

app.get('/ghin/:ghinNumber', adminAuthMiddleware, async (c) => {
  const ghinNumberParam = c.req.param('ghinNumber');
  const ghinNumber = Number(ghinNumberParam);
  if (!Number.isInteger(ghinNumber) || ghinNumber <= 0) {
    return c.json({ error: 'Invalid GHIN number', code: 'INVALID_GHIN' }, 400);
  }

  if (!ghinClient) {
    return c.json(
      { error: 'GHIN credentials not configured', code: 'GHIN_NOT_CONFIGURED' },
      503,
    );
  }

  try {
    const { handicapIndex } = await ghinClient.getHandicap(ghinNumber);
    return c.json(
      { ghinNumber, handicapIndex, retrievedAt: new Date().toISOString() },
      200,
    );
  } catch (err) {
    const code = (err as Error).message;
    if (code === 'NOT_FOUND') {
      return c.json({ error: 'GHIN number not found', code: 'NOT_FOUND' }, 404);
    }
    if (code === 'GHIN_AUTH_FAILED') {
      return c.json({ error: 'GHIN credentials invalid', code: 'GHIN_AUTH_FAILED' }, 503);
    }
    return c.json({ error: 'GHIN API unavailable', code: 'GHIN_UNAVAILABLE' }, 503);
  }
});

export default app;
