import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { env } from './lib/env.js';
import { adminCoursesRouter } from './routes/admin-courses.js';
import { authRouter } from './routes/auth.js';
import { coursesRouter } from './routes/courses.js';
import { requestIdMiddleware } from './middleware/request-id.js';

const STARTUP_TIME = Date.now();

const app = new Hono();

// Request-id middleware (T1-7) mounts FIRST so every downstream middleware
// — including CSRF below, auth, and route handlers — can read
// `c.get('requestId')` and `c.get('logger')`. The child logger emits
// `requestId` on every log line without per-call-site threading.
app.use('*', requestIdMiddleware);

// CSRF protection. `new URL(...).origin` normalizes to `scheme://host[:port]`
// with no path or trailing slash — avoids a class of origin-matching bugs
// where trailing slashes, path components, or port mismatches cause
// legitimate requests to be rejected. Hono's csrf only applies to unsafe
// methods (POST/PUT/PATCH/DELETE), so GET /api/health is unaffected.
const origin = new URL(env.PUBLIC_APP_URL).origin;
app.use('*', csrf({ origin }));

app.get('/api/health', (c) =>
  c.json({ status: 'ok', startupTime: STARTUP_TIME }),
);

// Auth router (T1-6b). Mounted at /api/auth so routes appear at
// /api/auth/status, /api/auth/google, /api/auth/google/callback.
app.route('/api/auth', authRouter);

// Courses router (T2-2). Single route: GET /api/courses.
app.route('/api/courses', coursesRouter);

// Admin-courses router (T2-3). POST /api/admin/courses/parse-pdf —
// organizer-gated scorecard-PDF → Anthropic Vision → structured JSON.
app.route('/api/admin', adminCoursesRouter);

export { app };
