import { Hono } from 'hono';
import { eq, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pairingHistory, players, seasons } from '../db/schema.js';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /pairing-history?seasonId=X — public, season-scoped pairing counts
// ---------------------------------------------------------------------------
//
// Returns the season's full pairing history with player names so the public
// "Pairing History" page can render a per-player list and prove the
// weighted-average pairing algorithm is fair. Defaults to the current
// (max-year) season when seasonId is omitted.
//
// Pre-2026 seasons return empty pairs because group-level pairing data was
// not captured for the 2022-2025 historical import — the page renders a
// dedicated empty state for that case.
//
// Pairing rows are written only on round finalize (story 9.1, AC #1) and
// only for finalized official rounds, so cancelled / practice / hidden
// rounds are already excluded by construction.

app.get('/pairing-history', async (c) => {
  const seasonIdParam = c.req.query('seasonId');

  // List all seasons so the page can render the season picker without a
  // second round-trip. (Public read; mirrors what /admin/seasons exposes
  // but limited to picker-relevant fields.)
  let allSeasons;
  try {
    allSeasons = await db
      .select({ id: seasons.id, name: seasons.name, year: seasons.year })
      .from(seasons)
      .orderBy(desc(seasons.year));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (allSeasons.length === 0) {
    return c.json({ seasons: [], season: null, players: [], pairs: [] }, 200);
  }

  // Resolve target season — explicit seasonId wins, otherwise current (max year).
  let targetSeason = allSeasons[0]!;
  if (seasonIdParam) {
    const seasonId = Number(seasonIdParam);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      return c.json({ error: 'Invalid seasonId', code: 'INVALID_PARAM' }, 400);
    }
    const match = allSeasons.find((s) => s.id === seasonId);
    if (!match) {
      return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
    }
    targetSeason = match;
  }

  try {
    const rows = await db
      .select({
        playerAId: pairingHistory.playerAId,
        playerBId: pairingHistory.playerBId,
        pairCount: pairingHistory.pairCount,
      })
      .from(pairingHistory)
      .where(eq(pairingHistory.seasonId, targetSeason.id));

    if (rows.length === 0) {
      return c.json(
        { seasons: allSeasons, season: targetSeason, players: [], pairs: [] },
        200,
      );
    }

    // Collect every player id referenced in the season's pairing rows so the
    // page can label rows + sort the picker.
    const idSet = new Set<number>();
    for (const r of rows) {
      idSet.add(r.playerAId);
      idSet.add(r.playerBId);
    }
    const idList = [...idSet];

    const playerRows = await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(inArray(players.id, idList))
      .orderBy(players.name);

    return c.json(
      {
        seasons: allSeasons,
        season: targetSeason,
        players: playerRows,
        pairs: rows,
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
