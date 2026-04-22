import { Hono } from 'hono';

/**
 * Auth sub-router stub. T1-6a scope is infrastructure only; the real
 * OAuth sign-in/callback routes land in T1-6b.
 *
 * This file exists so T1-6b's diff looks like pure handler additions
 * rather than file-plus-handler, and so T1-6a has a trivial integration
 * anchor for the middleware chain.
 *
 * NOT mounted on the main app yet — T1-6b will add
 * `app.route('/auth', authRouter)` when it wires the real handlers.
 */
export const authRouter = new Hono();

authRouter.get('/status', (c) =>
  c.json({ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' }),
);
