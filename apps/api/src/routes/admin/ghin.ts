import { Hono } from 'hono';
import { ghinClient } from '../../lib/ghin-client.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

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

  // Check if golfer exists (returns undefined when not found)
  let golfer: unknown;
  try {
    golfer = await ghinClient.golfers.getOne(ghinNumber);
  } catch {
    return c.json({ error: 'GHIN API unavailable', code: 'GHIN_UNAVAILABLE' }, 503);
  }

  if (!golfer) {
    return c.json({ error: 'GHIN number not found', code: 'NOT_FOUND' }, 404);
  }

  // Fetch handicap index
  let handicapRaw: string | number | null;
  try {
    const result = await ghinClient.handicaps.getOne(ghinNumber);
    handicapRaw = result.handicap_index;
  } catch {
    return c.json({ error: 'GHIN API unavailable', code: 'GHIN_UNAVAILABLE' }, 503);
  }

  const handicapIndex = handicapRaw !== null ? Number(handicapRaw) : null;

  return c.json(
    {
      ghinNumber,
      handicapIndex,
      retrievedAt: new Date().toISOString(),
    },
    200,
  );
});

export default app;
