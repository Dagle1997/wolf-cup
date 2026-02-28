import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { db } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Variables } from '../types.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const adminAuthMiddleware: MiddlewareHandler<{
  Variables: Variables;
}> = async (c, next) => {
  const sessionId = getCookie(c, 'session');

  if (!sessionId) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  let session: { id: string; adminId: number; expiresAt: number } | undefined;
  try {
    session = await db
      .select({
        id: sessions.id,
        adminId: sessions.adminId,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!session || session.expiresAt < Date.now()) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  // Sliding expiry: extend session TTL on each authenticated request (NFR22)
  const newExpiresAt = Date.now() + SESSION_TTL_MS;
  try {
    await db
      .update(sessions)
      .set({ expiresAt: newExpiresAt })
      .where(eq(sessions.id, sessionId));
  } catch {
    // Non-fatal: session slide failure shouldn't block the request
  }

  c.set('adminId', session.adminId);
  await next();
};
