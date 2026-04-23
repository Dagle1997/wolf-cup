import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { env } from './lib/env.js';
import { authRouter } from './routes/auth.js';

const STARTUP_TIME = Date.now();

const app = new Hono();

// CSRF protection. `new URL(...).origin` normalizes to `scheme://host[:port]`
// with no path or trailing slash — avoids a class of origin-matching bugs
// where trailing slashes, path components, or port mismatches cause
// legitimate requests to be rejected. Hono's csrf only applies to unsafe
// methods (POST/PUT/PATCH/DELETE), so GET /api/health is unaffected.
//
// Mounted globally BEFORE any middleware that reads cookies so the check
// runs before anything else does work on the request.
const origin = new URL(env.PUBLIC_APP_URL).origin;
app.use('*', csrf({ origin }));

app.get('/api/health', (c) =>
  c.json({ status: 'ok', startupTime: STARTUP_TIME }),
);

// Auth router (T1-6b). Mounted at /api/auth so routes appear at
// /api/auth/status, /api/auth/google, /api/auth/google/callback.
app.route('/api/auth', authRouter);

export { app };
