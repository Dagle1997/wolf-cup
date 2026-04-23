import { serve } from '@hono/node-server';
import { app } from './app.js';
import { resolvePort } from './port.js';
import { logger } from './lib/log.js';

const port = resolvePort();

serve({ fetch: app.fetch, port });

logger.info({ port, msg: 'Tournament API listening' });
