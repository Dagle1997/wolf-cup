import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { seasons } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { buildHouseLedger } from '../../lib/house-ledger.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /the-house — admin-only "The House" P&L + calibration ledger for the
// current season (recompute-on-read; see lib/house-ledger.ts). Surfaced as an
// admin dashboard item rather than on the public scouting page.
// ---------------------------------------------------------------------------

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

app.get('/the-house', adminAuthMiddleware, async (c) => {
  const all = await db.select({ id: seasons.id, name: seasons.name, year: seasons.year, startDate: seasons.startDate, endDate: seasons.endDate }).from(seasons);
  if (all.length === 0) return c.json({ season: null, ledger: null }, 200);

  const today = todayIso();
  // Deterministic: prefer the most recent in-window season, else the latest year.
  const byYearDesc = [...all].sort((a, b) => b.year - a.year);
  const current = byYearDesc.find((s) => s.startDate <= today && today <= s.endDate) ?? byYearDesc[0]!;

  // Pass the season's endDate so the ledger covers every finalized week in it.
  const ledger = await buildHouseLedger(current.id, current.endDate);
  return c.json({ season: { id: current.id, name: current.name, year: current.year }, ledger }, 200);
});

export default app;
