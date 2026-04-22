import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { requireOrganizer } from './require-organizer.js';

/**
 * The real flow always pairs requireSession + requireOrganizer. For unit
 * testing requireOrganizer in isolation we plant the `player` variable
 * directly via a tiny stub middleware. This keeps the tests focused on
 * the organizer check's branches.
 */
function stubPlayerMiddleware(player: { id: string; isOrganizer: boolean } | undefined) {
  return async (c: import('hono').Context, next: () => Promise<void>) => {
    if (player !== undefined) {
      c.set('player', player);
    }
    await next();
  };
}

describe('requireOrganizer middleware', () => {
  test('next() called when player.isOrganizer is true', async () => {
    const app = new Hono();
    app.use('*', stubPlayerMiddleware({ id: 'p-org', isOrganizer: true }));
    app.use('*', requireOrganizer);
    app.get('/admin', (c) => c.json({ ok: true }));

    const res = await app.request('/admin');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('403 not_organizer when player.isOrganizer is false', async () => {
    const app = new Hono();
    app.use('*', stubPlayerMiddleware({ id: 'p-plain', isOrganizer: false }));
    app.use('*', requireOrganizer);
    app.get('/admin', (c) => c.json({ ok: true }));

    const res = await app.request('/admin');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe('not_organizer');
    expect(typeof body.requestId).toBe('string');
  });

  test('500 middleware_misuse when player variable is not set (requireSession missing)', async () => {
    const app = new Hono();
    // Intentionally omit the stub — mimics a developer chaining
    // `app.use(requireOrganizer)` without `requireSession` ahead of it.
    app.use('*', requireOrganizer);
    app.get('/admin', (c) => c.json({ ok: true }));

    const res = await app.request('/admin');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('middleware_misuse');
  });
});
