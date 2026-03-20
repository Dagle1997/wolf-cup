import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context, Next } from 'hono';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted mock state — accessible inside vi.mock factory
// ---------------------------------------------------------------------------

const ghinMocks = vi.hoisted(() => {
  const mockGetHandicap = vi.fn();
  const mockSearchByName = vi.fn();
  const state = { useNull: false };
  return { mockGetHandicap, mockSearchByName, state };
});

vi.mock('../../lib/ghin-client.js', () => ({
  get ghinClient() {
    if (ghinMocks.state.useNull) return null;
    return {
      getHandicap: ghinMocks.mockGetHandicap,
      searchByName: ghinMocks.mockSearchByName,
    };
  },
}));

vi.mock('../../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

// Import AFTER mocks are set up
import ghinRouter from './ghin.js';

const app = new Hono();
app.route('/admin', ghinRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /admin/ghin/:ghinNumber', () => {
  beforeEach(() => {
    ghinMocks.state.useNull = false;
    ghinMocks.mockGetHandicap.mockReset();
    ghinMocks.mockSearchByName.mockReset();
  });

  it('returns 503 GHIN_NOT_CONFIGURED when env vars absent', async () => {
    ghinMocks.state.useNull = true;
    const res = await app.request('/admin/ghin/12345');
    expect(res.status).toBe(503);
    const json = await res.json() as { code: string };
    expect(json.code).toBe('GHIN_NOT_CONFIGURED');
  });

  it('returns 400 for non-numeric GHIN', async () => {
    const res = await app.request('/admin/ghin/abc');
    expect(res.status).toBe(400);
    const json = await res.json() as { code: string };
    expect(json.code).toBe('INVALID_GHIN');
  });

  it('returns 400 for GHIN <= 0', async () => {
    const res = await app.request('/admin/ghin/0');
    expect(res.status).toBe(400);
  });

  it('returns 404 when golfer not found', async () => {
    ghinMocks.mockGetHandicap.mockRejectedValue(new Error('NOT_FOUND'));
    const res = await app.request('/admin/ghin/99999');
    expect(res.status).toBe(404);
    const json = await res.json() as { code: string };
    expect(json.code).toBe('NOT_FOUND');
  });

  it('returns 200 with handicap index on success', async () => {
    ghinMocks.mockGetHandicap.mockResolvedValue({ handicapIndex: 14.2 });
    const res = await app.request('/admin/ghin/1234567');
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ghinNumber: number;
      handicapIndex: number;
      retrievedAt: string;
    };
    expect(json.ghinNumber).toBe(1234567);
    expect(json.handicapIndex).toBe(14.2);
    expect(typeof json.retrievedAt).toBe('string');
  });

  it('returns handicapIndex null when GHIN returns null HI', async () => {
    ghinMocks.mockGetHandicap.mockResolvedValue({ handicapIndex: null });
    const res = await app.request('/admin/ghin/1234567');
    expect(res.status).toBe(200);
    const json = await res.json() as { handicapIndex: null };
    expect(json.handicapIndex).toBeNull();
  });

  it('returns 503 GHIN_UNAVAILABLE when getHandicap throws', async () => {
    ghinMocks.mockGetHandicap.mockRejectedValue(new Error('Network timeout'));
    const res = await app.request('/admin/ghin/1234567');
    expect(res.status).toBe(503);
    const json = await res.json() as { code: string };
    expect(json.code).toBe('GHIN_UNAVAILABLE');
  });
});
