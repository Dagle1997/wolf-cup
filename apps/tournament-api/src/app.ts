import { Hono } from 'hono';

export const STARTUP_TIME = Date.now();

const app = new Hono();

app.get('/api/health', (c) =>
  c.json({ status: 'ok', startupTime: STARTUP_TIME }),
);

export { app };
