import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { SEASON_ODDS } from '../db/season-odds-data.js';
import { normalizePlayerName } from '../db/history-data.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// GET /seasons/:year/odds
// Returns the opening + current board for a season, plus any line moves.
// Read-only; data lives in season-odds-data.ts. Unknown year → 404.
// ---------------------------------------------------------------------------

app.get('/seasons/:year/odds', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2015) {
    return c.json({ error: 'Invalid year', code: 'INVALID_YEAR' }, 400);
  }

  const season = SEASON_ODDS.find((s) => s.year === year);
  if (!season) {
    return c.json({ error: 'No odds posted for this season', code: 'NO_ODDS' }, 404);
  }

  // Resolve each odds-file name to a canonical DB name, then batch-lookup
  // player rows so the client gets stable IDs (nice to have for future links).
  const resolvedNames = season.players.map((p) => normalizePlayerName(p.name));
  const playerRows = resolvedNames.length
    ? await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(inArray(players.name, resolvedNames))
    : [];
  const playerIdByName = new Map(playerRows.map((r) => [r.name, r.id]));

  const board = season.players.map((p) => {
    const canonicalName = normalizePlayerName(p.name);
    const first = p.timeline[0];
    const last = p.timeline[p.timeline.length - 1];
    if (!first || !last) {
      return null; // guard against bad data; filter below
    }
    const movement = last.odds - first.odds;
    return {
      playerId: playerIdByName.get(canonicalName) ?? null,
      name: canonicalName,
      displayName: p.name === canonicalName ? canonicalName : p.name,
      currentOdds: last.odds,
      openingOdds: first.odds,
      movement, // positive → line lengthened (longer shot), negative → shortened
      lastMovedAt: last.asOf,
      note: last.note ?? null,
      timeline: p.timeline,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // Sort shortest → longest (favorites first)
  board.sort((a, b) => a.currentOdds - b.currentOdds);

  // Flat chronological list of all mid-season moves (timeline entries after the first)
  const moves: Array<{
    name: string;
    from: number;
    to: number;
    asOf: string;
    note: string | null;
  }> = [];
  for (const p of season.players) {
    const name = normalizePlayerName(p.name);
    for (let i = 1; i < p.timeline.length; i++) {
      const prev = p.timeline[i - 1]!;
      const cur = p.timeline[i]!;
      moves.push({
        name,
        from: prev.odds,
        to: cur.odds,
        asOf: cur.asOf,
        note: cur.note ?? null,
      });
    }
  }
  moves.sort((a, b) => b.asOf.localeCompare(a.asOf));

  return c.json(
    {
      year: season.year,
      openedAt: season.openedAt,
      board,
      moves,
    },
    200,
  );
});

export default app;
