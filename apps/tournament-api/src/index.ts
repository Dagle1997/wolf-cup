import { serve } from '@hono/node-server';
import { app } from './app.js';
import { resolvePort } from './port.js';

const port = resolvePort();

serve({ fetch: app.fetch, port });

console.log(`Tournament API listening on port ${port}`);
