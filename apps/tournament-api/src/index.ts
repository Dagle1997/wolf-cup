import { serve } from '@hono/node-server';
import { app } from './app.js';

function resolvePort(): number {
  const raw = process.env['PORT'];
  if (!raw) return 3000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(`Invalid PORT="${raw}"; falling back to 3000`);
    return 3000;
  }
  return parsed;
}

const port = resolvePort();

serve({ fetch: app.fetch, port });

console.log(`Tournament API listening on port ${port}`);
