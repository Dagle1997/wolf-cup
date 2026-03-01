import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Variables } from './types.js';
import publicRoundsRouter from './routes/rounds.js';
import leaderboardRouter from './routes/leaderboard.js';
import standingsRouter from './routes/standings.js';
import statsRouter from './routes/stats.js';
import adminAuthRouter from './routes/admin/auth.js';
import adminRosterRouter from './routes/admin/roster.js';
import adminSeasonRouter from './routes/admin/season.js';
import adminRoundsRouter from './routes/admin/rounds.js';
import adminSideGamesRouter from './routes/admin/side-games.js';
import adminScoreCorrectionsRouter from './routes/admin/score-corrections.js';

export const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// Health check — public, no auth required
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Public rounds routes
// ---------------------------------------------------------------------------

app.route('/api', publicRoundsRouter);
app.route('/api', leaderboardRouter);
app.route('/api', standingsRouter);
app.route('/api', statsRouter);

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

app.route('/api/admin', adminAuthRouter);
app.route('/api/admin', adminRosterRouter);
app.route('/api/admin', adminSeasonRouter);
app.route('/api/admin', adminRoundsRouter);
app.route('/api/admin', adminSideGamesRouter);
app.route('/api/admin', adminScoreCorrectionsRouter);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = Number(process.env['PORT'] ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Wolf Cup API listening on port ${port}`);
});
