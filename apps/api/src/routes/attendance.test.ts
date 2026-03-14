import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq, inArray } from 'drizzle-orm';

// Mock db before any imports that use it
vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

// Mock adminAuthMiddleware to bypass auth
vi.mock('../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

import { Hono } from 'hono';
import attendanceRouter from './attendance.js';
import adminAttendanceRouter from './admin/attendance.js';
import { db } from '../db/index.js';
import { seasons, seasonWeeks, players, attendance } from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../db/migrations');

// Create a combined app for testing
const app = new Hono();
app.route('/api', attendanceRouter);
app.route('/api/admin', adminAttendanceRouter);

let seasonId: number;
let weekId: number;
let player1Id: number;
let player2Id: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed players
  const [p1] = await db.insert(players).values({ name: 'Alice', handicapIndex: 10.2, createdAt: Date.now() }).returning();
  const [p2] = await db.insert(players).values({ name: 'Bob', handicapIndex: 15.0, createdAt: Date.now() }).returning();
  player1Id = p1!.id;
  player2Id = p2!.id;

  // Seed season with weeks
  const [s] = await db
    .insert(seasons)
    .values({
      name: 'Test Season',
      startDate: '2026-04-10',
      endDate: '2026-05-01',
      totalRounds: 4,
      playoffFormat: 'top4',
      createdAt: Date.now(),
    })
    .returning();
  seasonId = s!.id;

  // Create weeks (all active, with tees)
  const fridays = ['2026-04-10', '2026-04-17', '2026-04-24', '2026-05-01'];
  const tees = ['blue', 'black', 'white', 'blue'] as const;
  for (let i = 0; i < fridays.length; i++) {
    await db.insert(seasonWeeks).values({
      seasonId,
      friday: fridays[i]!,
      isActive: 1,
      tee: tees[i]!,
      createdAt: Date.now(),
    });
  }

  const weeks = await db.select().from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId)).orderBy(seasonWeeks.friday);
  weekId = weeks[0]!.id;
});

afterEach(async () => {
  // Clean up attendance records
  const weekIds = (await db.select({ id: seasonWeeks.id }).from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId))).map((w) => w.id);
  if (weekIds.length > 0) {
    await db.delete(attendance).where(inArray(attendance.seasonWeekId, weekIds));
  }
});

// ---------------------------------------------------------------------------
// GET /attendance — public
// ---------------------------------------------------------------------------

describe('GET /attendance', () => {
  it('returns current week with full roster and unset statuses', async () => {
    const res = await app.request('/api/attendance', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceResponse;
    expect(body.week).not.toBeNull();
    expect(body.week!.tee).toBeTruthy();
    expect(body.players.length).toBeGreaterThanOrEqual(2);
    expect(body.confirmed).toBe(0);
    expect(body.total).toBeGreaterThanOrEqual(2);
    // All statuses should be unset initially
    expect(body.players.every((p) => p.status === 'unset')).toBe(true);
  });

  it('returns graceful empty response when no season exists', async () => {
    // Delete all seasons temporarily
    await db.delete(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId));
    await db.delete(seasons).where(eq(seasons.id, seasonId));

    const res = await app.request('/api/attendance', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceResponse;
    expect(body.week).toBeNull();
    expect(body.players).toEqual([]);

    // Restore season + weeks
    const [s] = await db
      .insert(seasons)
      .values({ id: seasonId, name: 'Test Season', startDate: '2026-04-10', endDate: '2026-05-01', totalRounds: 4, playoffFormat: 'top4', createdAt: Date.now() })
      .returning();
    const fridays = ['2026-04-10', '2026-04-17', '2026-04-24', '2026-05-01'];
    const tees = ['blue', 'black', 'white', 'blue'] as const;
    for (let i = 0; i < fridays.length; i++) {
      await db.insert(seasonWeeks).values({
        seasonId: s!.id,
        friday: fridays[i]!,
        isActive: 1,
        tee: tees[i]!,
        createdAt: Date.now(),
      });
    }
    const weeks = await db.select().from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId)).orderBy(seasonWeeks.friday);
    weekId = weeks[0]!.id;
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/attendance/:weekId/players/:playerId — toggle
// ---------------------------------------------------------------------------

describe('PATCH /admin/attendance/:weekId/players/:playerId', () => {
  it('creates attendance record (upsert — first toggle)', async () => {
    const res = await app.request(
      `/api/admin/attendance/${weekId}/players/${player1Id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; confirmed: number; total: number };
    expect(body.status).toBe('in');
    expect(body.confirmed).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it('updates existing attendance record (upsert — second toggle)', async () => {
    // First set to 'in'
    await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });

    // Then toggle to 'out'
    const res = await app.request(
      `/api/admin/attendance/${weekId}/players/${player1Id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'out' }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; confirmed: number };
    expect(body.status).toBe('out');
    expect(body.confirmed).toBe(0); // was in, now out
  });

  it('returns correct confirmed count with multiple players', async () => {
    // Set both players to 'in'
    await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });
    const res = await app.request(`/api/admin/attendance/${weekId}/players/${player2Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });

    const body = (await res.json()) as { confirmed: number };
    expect(body.confirmed).toBe(2);
  });

  it('returns 404 for non-existent week', async () => {
    const res = await app.request(`/api/admin/attendance/99999/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const res = await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/attendance/:weekId — admin view
// ---------------------------------------------------------------------------

describe('GET /admin/attendance/:weekId', () => {
  it('returns attendance for specific week with statuses', async () => {
    // Set a player to 'in'
    await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });

    const res = await app.request(`/api/admin/attendance/${weekId}`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceResponse;
    expect(body.week!.id).toBe(weekId);
    expect(body.confirmed).toBe(1);

    const alice = body.players.find((p) => p.id === player1Id);
    expect(alice?.status).toBe('in');

    const bob = body.players.find((p) => p.id === player2Id);
    expect(bob?.status).toBe('unset');
  });

  it('returns 404 for non-existent week', async () => {
    const res = await app.request('/api/admin/attendance/99999', {
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceResponse = {
  week: { id: number; friday: string; weekNumber: number; tee: string | null } | null;
  players: { id: number; name: string; handicapIndex: number | null; status: string }[];
  confirmed: number;
  total: number;
};
