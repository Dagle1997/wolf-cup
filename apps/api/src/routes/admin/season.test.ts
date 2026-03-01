import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq } from 'drizzle-orm';

// Mock db before any imports that use it
vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

// Mock adminAuthMiddleware to bypass auth
vi.mock('../../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

import seasonApp from './season.js';
import { db } from '../../db/index.js';
import { seasons } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

let testSeasonId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed a baseline season
  const rows = await db
    .insert(seasons)
    .values({
      name: 'Baseline Season',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 17,
      playoffFormat: 'top8',
      createdAt: Date.now(),
    })
    .returning();
  testSeasonId = rows[0]!.id;
});

afterEach(async () => {
  // Delete test-created seasons (keep baseline)
  await db.delete(seasons).where(eq(seasons.name, 'Test Season'));
  // Reset baseline season to known state (including harvey toggle)
  await db
    .update(seasons)
    .set({ name: 'Baseline Season', totalRounds: 17, harveyLiveEnabled: 0 })
    .where(eq(seasons.id, testSeasonId));
});

// ---------------------------------------------------------------------------
// GET /seasons
// ---------------------------------------------------------------------------

describe('GET /seasons', () => {
  it('returns items array with all seasons', async () => {
    const res = await seasonApp.request('/seasons', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// POST /seasons
// ---------------------------------------------------------------------------

describe('POST /seasons', () => {
  it('creates a season and returns 201', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        totalRounds: 10,
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { season: { id: number; name: string; totalRounds: number } };
    expect(body.season.name).toBe('Test Season');
    expect(body.season.totalRounds).toBe(10);
    expect(body.season.id).toBeTypeOf('number');
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2027-01-01', endDate: '2027-12-31', totalRounds: 10, playoffFormat: 'top4' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when totalRounds is 0', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Season', startDate: '2027-01-01', endDate: '2027-12-31', totalRounds: 0, playoffFormat: 'top4' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when date format is invalid', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Season', startDate: 'January 1 2027', endDate: '2027-12-31', totalRounds: 10, playoffFormat: 'top4' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:id
// ---------------------------------------------------------------------------

describe('PATCH /seasons/:id', () => {
  it('updates a season field and returns 200', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalRounds: 15 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { season: { totalRounds: number } };
    expect(body.season.totalRounds).toBe(15);
  });

  it('returns 404 NOT_FOUND for unknown season ID', async () => {
    const res = await seasonApp.request('/seasons/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when body has no fields', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:id — Harvey live toggle (FR41)
// ---------------------------------------------------------------------------

describe('PATCH /seasons/:id — harveyLiveEnabled toggle', () => {
  it('enables Harvey live display (harveyLiveEnabled: true → 200, DB harvey_live_enabled = 1)', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harveyLiveEnabled: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { season: { id: number; harveyLiveEnabled: number } };
    expect(body.season.harveyLiveEnabled).toBe(1);
    expect(body.season.id).toBe(testSeasonId);

    // Verify DB updated
    const row = await db
      .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
      .from(seasons)
      .where(eq(seasons.id, testSeasonId))
      .get();
    expect(row?.harveyLiveEnabled).toBe(1);
  });

  it('disables Harvey live display (harveyLiveEnabled: false → 200, DB harvey_live_enabled = 0)', async () => {
    // First enable it
    await db.update(seasons).set({ harveyLiveEnabled: 1 }).where(eq(seasons.id, testSeasonId));

    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harveyLiveEnabled: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { season: { harveyLiveEnabled: number } };
    expect(body.season.harveyLiveEnabled).toBe(0);

    // Verify DB updated
    const row = await db
      .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
      .from(seasons)
      .where(eq(seasons.id, testSeasonId))
      .get();
    expect(row?.harveyLiveEnabled).toBe(0);
  });

  it('returns 400 VALIDATION_ERROR when harveyLiveEnabled is non-boolean', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harveyLiveEnabled: 'on' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
