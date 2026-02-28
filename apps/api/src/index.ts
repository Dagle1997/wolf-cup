import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Variables } from './types.js';

export const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// Health check — public, no auth required
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = Number(process.env['PORT'] ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Wolf Cup API listening on port ${port}`);
});
