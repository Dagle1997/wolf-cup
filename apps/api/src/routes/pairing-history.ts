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
// (max-year) season with data when seasonId is omitted.
//
// The `seasons` list returned for the picker is filtered to seasons that
// have at least one pairing_history row — pre-2026 historical seasons were
// imported without group-level data and there's no value in surfacing them
// in the picker only to render an empty state.
//
// Pairing rows are written only on round finalize (story 9.1, AC #1) and
// only for finalized official rounds, so cancelled / practice / hidden
// rounds are already excluded by construction.

app.get('/pairing-history', async (c) => {
  const seasonIdParam = c.req.query('seasonId');

  // Picker source: seasons that actually have pairing data. Joining + DISTINCT
  // keeps this to a single round-trip and avoids surfacing the historical
  // 2015–2025 import seasons (no group-level data) in the picker.
  let availableSeasons;
  try {
    availableSeasons = await db
      .selectDistinct({ id: seasons.id, name: seasons.name, year: seasons.year })
      .from(seasons)
      .innerJoin(pairingHistory, eq(pairingHistory.seasonId, seasons.id))
      .orderBy(desc(seasons.year));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Explicit seasonId always validates against the full seasons table — a
  // direct API caller asking about a known but data-less season should get
  // a clean 200 with empty pairs, not a 404.
  let targetSeason: { id: number; name: string; year: number } | null = availableSeasons[0] ?? null;
  if (seasonIdParam) {
    const seasonId = Number(seasonIdParam);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      return c.json({ error: 'Invalid seasonId', code: 'INVALID_PARAM' }, 400);
    }
    let row;
    try {
      row = await db
        .select({ id: seasons.id, name: seasons.name, year: seasons.year })
        .from(seasons)
        .where(eq(seasons.id, seasonId))
        .get();
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!row) {
      return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
    }
    targetSeason = row;
  }

  if (!targetSeason) {
    return c.json({ seasons: [], season: null, players: [], pairs: [] }, 200);
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
        { seasons: availableSeasons, season: targetSeason, players: [], pairs: [] },
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
        seasons: availableSeasons,
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
