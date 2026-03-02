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

  let golfers: Awaited<ReturnType<typeof ghinClient.golfers.search>>;
  try {
    golfers = await ghinClient.golfers.search({
      last_name: lastName,
      ...(firstName ? { first_name: firstName } : {}),
      status: 'Active',
    });
  } catch {
    return c.json({ error: 'GHIN API unavailable', code: 'GHIN_UNAVAILABLE' }, 503);
  }

  const results = golfers.slice(0, 20).map((g) => ({
    ghinNumber: g.ghin,
    firstName: g.first_name,
    lastName: g.last_name,
    handicapIndex: g.handicap_index !== null ? Number(g.handicap_index) : null,
    club: g.club_name ?? null,
    state: g.state ?? null,
  }));

  return c.json({ results }, 200);
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
