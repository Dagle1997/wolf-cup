import { describe, it, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import oddsApp from './odds.js';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  // Seed a couple of canonical players that match the 2026 odds file,
  // so playerId lookups in the board exercise the join path.
  await db.insert(players).values([
    { name: 'Matt Jaquint', ghinNumber: null, isActive: 1, createdAt: Date.now() },
    { name: 'Jason Moses', ghinNumber: null, isActive: 1, createdAt: Date.now() },
  ]);
});

describe('GET /seasons/:year/odds', () => {
  it('returns 400 for non-integer year', async () => {
    const res = await oddsApp.request('/seasons/abc/odds');
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_YEAR');
  });

  it('returns 404 when no odds are posted for the season', async () => {
    // 2027 is after the guard but has no entry in SEASON_ODDS
    const res = await oddsApp.request('/seasons/2027/odds');
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NO_ODDS');
  });

  it('returns 2026 board sorted shortest → longest with opening = current on fresh data', async () => {
    const res = await oddsApp.request('/seasons/2026/odds');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      year: number;
      openedAt: string;
      board: Array<{
        name: string;
        currentOdds: number;
        openingOdds: number;
        movement: number;
        playerId: number | null;
      }>;
      moves: unknown[];
    };
    expect(body.year).toBe(2026);
    expect(body.openedAt).toBe('2026-04-17');
    expect(body.board.length).toBe(17);
    // Jaquint opens shortest at +250
    expect(body.board[0]!.name).toBe('Matt Jaquint');
    expect(body.board[0]!.currentOdds).toBe(250);
    expect(body.board[0]!.openingOdds).toBe(250);
    expect(body.board[0]!.movement).toBe(0);
    // Chris Keaton is the longest at +1200
    const last = body.board[body.board.length - 1]!;
    expect(last.currentOdds).toBe(1200);
    // Shortest → longest sort holds across the board
    for (let i = 1; i < body.board.length; i++) {
      expect(body.board[i]!.currentOdds).toBeGreaterThanOrEqual(body.board[i - 1]!.currentOdds);
    }
    // No moves on fresh opening data
    expect(body.moves).toHaveLength(0);
  });

  it('resolves "Moses" → "Jason Moses" via normalizePlayerName and attaches the seeded playerId', async () => {
    const res = await oddsApp.request('/seasons/2026/odds');
    const body = await res.json() as {
      board: Array<{ name: string; playerId: number | null }>;
    };
    const moses = body.board.find((r) => r.name === 'Jason Moses');
    expect(moses).toBeDefined();
    expect(moses!.playerId).not.toBeNull();
  });

  it('surfaces the admin note on a line when present', async () => {
    const res = await oddsApp.request('/seasons/2026/odds');
    const body = await res.json() as {
      board: Array<{ name: string; note: string | null }>;
    };
    // Matt White's nickname isn't noted in the file, but Ben McGinnis (Ole Peach) is
    const mcginnis = body.board.find((r) => r.name === 'Ben McGinnis');
    expect(mcginnis?.note).toBe('Ole Peach');
  });
});
