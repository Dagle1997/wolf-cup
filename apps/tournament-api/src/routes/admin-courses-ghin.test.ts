/**
 * admin-courses-ghin router — wiring/guard tests. The GHIN client is null in
 * the test env (no creds), so the search/details happy paths return 503; the
 * mapping logic itself is covered by ghin-course-map.test.ts. These tests
 * pin the auth chain, query validation, and the not-configured posture.
 */
import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';

let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../middleware/require-session.js', () => ({
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
    if (!__testPlayer) return c.json({ error: 'unauthorized', code: 'no_session' }, 401);
    c.set('player', __testPlayer);
    await next();
  },
}));

const { adminCoursesGhinRouter } = await import('./admin-courses-ghin.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

function app(player: { id: string; isOrganizer: boolean } | null): Hono {
  __testPlayer = player;
  const a = new Hono();
  a.use('*', requestIdMiddleware);
  a.route('/api/admin', adminCoursesGhinRouter);
  return a;
}

const ORG = { id: 'p1', isOrganizer: true };
const NON_ORG = { id: 'p2', isOrganizer: false };

describe('GET /api/admin/courses/ghin/search', () => {
  test('401 when unauthenticated', async () => {
    const res = await app(null).request('/api/admin/courses/ghin/search?q=Pete');
    expect(res.status).toBe(401);
  });

  test('403 when authenticated but not an organizer', async () => {
    const res = await app(NON_ORG).request('/api/admin/courses/ghin/search?q=Pete');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_organizer');
  });

  test('400 query_too_short for < 3 chars', async () => {
    const res = await app(ORG).request('/api/admin/courses/ghin/search?q=Pe');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('query_too_short');
  });

  test('503 ghin_not_configured when no GHIN creds (test env)', async () => {
    const res = await app(ORG).request('/api/admin/courses/ghin/search?q=Pete%20Dye');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('ghin_not_configured');
  });
});

describe('GET /api/admin/courses/ghin/:ghinCourseId', () => {
  test('400 invalid_course_id for non-numeric id', async () => {
    const res = await app(ORG).request('/api/admin/courses/ghin/not-a-number');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_course_id');
  });

  test('503 ghin_not_configured for a valid id when no creds', async () => {
    const res = await app(ORG).request('/api/admin/courses/ghin/5737');
    expect(res.status).toBe(503);
  });

  test('403 for non-organizer', async () => {
    const res = await app(NON_ORG).request('/api/admin/courses/ghin/5737');
    expect(res.status).toBe(403);
  });
});
