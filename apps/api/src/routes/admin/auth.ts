import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { admins, sessions } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { loginSchema } from '../../schemas/admin.js';
import type { Variables } from '../../types.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const app = new Hono<{ Variables: Variables }>();

app.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        issues: result.error.issues,
      },
      400,
    );
  }

  const { username, password } = result.data;

  let admin: { id: number; username: string; passwordHash: string } | undefined;
  try {
    admin = await db
      .select({
        id: admins.id,
        username: admins.username,
        passwordHash: admins.passwordHash,
      })
      .from(admins)
      .where(eq(admins.username, username))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!admin) {
    return c.json(
      { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      401,
    );
  }

  let passwordMatch = false;
  try {
    passwordMatch = await bcrypt.compare(password, admin.passwordHash);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!passwordMatch) {
    return c.json(
      { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      401,
    );
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;

  try {
    await db.insert(sessions).values({
      id: sessionId,
      adminId: admin.id,
      createdAt: Date.now(),
      expiresAt,
    });
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  });

  return c.json({ adminId: admin.id, username: admin.username }, 200);
});

app.post('/logout', adminAuthMiddleware, async (c) => {
  const sessionId = getCookie(c, 'session');

  if (sessionId) {
    try {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    } catch {
      // Non-fatal: session cleanup failed but we still clear the cookie
    }
  }

  deleteCookie(c, 'session', { path: '/' });
  return c.json({ success: true }, 200);
});

export default app;
