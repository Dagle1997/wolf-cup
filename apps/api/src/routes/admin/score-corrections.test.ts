import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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

import scoreCorrectionsApp from './score-corrections.js';
import { db } from '../../db/index.js';
import {
  admins,
  seasons,
  rounds,
  groups,
  players,
  roundPlayers,
  holeScores,
  wolfDecisions,
  scoreCorrections,
} from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

let testSeasonId: number;
let testRoundId: number;
let testGroupId: number;
let testPlayerId: number;
let testHoleScoreId: number;
let testWolfDecisionId: number;

// A non-finalized round for the 422 test
let scheduledRoundId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed admin with id=1 (required for score_corrections.admin_user_id FK)
  await db.insert(admins).values({
    username: 'test-admin-sc',
    passwordHash: 'hash',
    createdAt: Date.now(),
  });

  const [season] = await db
    .insert(seasons)
    .values({
      name: 'Test Season SC',
      year: 3090,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 17,
      playoffFormat: 'top8',
      createdAt: Date.now(),
    })
    .returning();
  testSeasonId = season!.id;

  // Finalized round for happy-path tests
  const [round] = await db
    .insert(rounds)
    .values({
      seasonId: testSeasonId,
      type: 'official',
      status: 'finalized',
      scheduledDate: '2026-06-06',
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning();
  testRoundId = round!.id;

  // Non-finalized round for 422 test
  const [scheduledRound] = await db
    .insert(rounds)
    .values({
      seasonId: testSeasonId,
      type: 'official',
      status: 'scheduled',
      scheduledDate: '2026-07-07',
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning();
  scheduledRoundId = scheduledRound!.id;

  const [group] = await db
    .insert(groups)
    .values({
      roundId: testRoundId,
      groupNumber: 1,
      battingOrder: null,
    })
    .returning();
  testGroupId = group!.id;

  const [player] = await db
    .insert(players)
    .values({
      name: 'Test Player SC',
      createdAt: Date.now(),
    })
    .returning();
  testPlayerId = player!.id;

  // Seed a hole score for grossScore correction tests
  const [hs] = await db
    .insert(holeScores)
    .values({
      roundId: testRoundId,
      groupId: testGroupId,
      playerId: testPlayerId,
      holeNumber: 5,
      grossScore: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning();
  testHoleScoreId = hs!.id;

  // Seed a wolf decision for wolfDecision/wolfPartnerId correction tests
  const [wd] = await db
    .insert(wolfDecisions)
    .values({
      roundId: testRoundId,
      groupId: testGroupId,
      holeNumber: 5,
      wolfPlayerId: testPlayerId,
      decision: 'partner',
      partnerPlayerId: null,
      createdAt: Date.now(),
    })
    .returning();
  testWolfDecisionId = wd!.id;
});

afterEach(async () => {
  // Delete test-created corrections
  await db.delete(scoreCorrections).where(eq(scoreCorrections.roundId, testRoundId));
  // Reset seeded hole_score to original value
  await db
    .update(holeScores)
    .set({ grossScore: 5, updatedAt: Date.now() })
    .where(eq(holeScores.id, testHoleScoreId));
  // Reset seeded wolf_decision to original values
  await db
    .update(wolfDecisions)
    .set({ decision: 'partner', partnerPlayerId: null })
    .where(eq(wolfDecisions.id, testWolfDecisionId));
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — grossScore
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — grossScore', () => {
  it('corrects grossScore and returns 201 with audit entry', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: '4',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      correction: {
        id: number;
        adminUserId: number;
        roundId: number;
        holeNumber: number;
        playerId: number;
        fieldName: string;
        oldValue: string;
        newValue: string;
        correctedAt: number;
      };
    };
    expect(body.correction.roundId).toBe(testRoundId);
    expect(body.correction.holeNumber).toBe(5);
    expect(body.correction.fieldName).toBe('grossScore');
    expect(body.correction.oldValue).toBe('5');
    expect(body.correction.newValue).toBe('4');
    expect(body.correction.playerId).toBe(testPlayerId);
    expect(body.correction.adminUserId).toBe(1);
    expect(body.correction.id).toBeTypeOf('number');
  });

  it('returns 404 NOT_FOUND for unknown round', async () => {
    const res = await scoreCorrectionsApp.request('/rounds/99999/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: '4',
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 422 ROUND_NOT_FINALIZED for non-finalized round', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${scheduledRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: '4',
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_FINALIZED');
  });

  it('returns 400 VALIDATION_ERROR when playerId is missing for grossScore', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        newValue: '4',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 NOT_FOUND when hole score row does not exist', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 17, // no score seeded for hole 17
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: '3',
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for invalid grossScore newValue', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: '99', // out of range
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for non-integer grossScore newValue', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: 'abc',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for partial-string grossScore newValue like "4abc"', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'grossScore',
        playerId: testPlayerId,
        newValue: '4abc',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — wolfDecision
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — wolfDecision', () => {
  it('corrects wolfDecision and returns 201 with audit entry', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfDecision',
        groupId: testGroupId,
        newValue: 'alone',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      correction: {
        fieldName: string;
        oldValue: string;
        newValue: string;
        playerId: null;
      };
    };
    expect(body.correction.fieldName).toBe('wolfDecision');
    expect(body.correction.oldValue).toBe('partner');
    expect(body.correction.newValue).toBe('alone');
    expect(body.correction.playerId).toBeNull();
  });

  it('returns 400 VALIDATION_ERROR when groupId is missing for wolfDecision', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfDecision',
        newValue: 'alone',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 NOT_FOUND when wolf decision row does not exist', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 17, // no wolf decision seeded for hole 17
        fieldName: 'wolfDecision',
        groupId: testGroupId,
        newValue: 'alone',
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for invalid wolfDecision newValue', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfDecision',
        groupId: testGroupId,
        newValue: 'invalid_decision',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — wolfPartnerId
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — wolfPartnerId', () => {
  it('sets wolfPartnerId to a valid player and returns 201', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfPartnerId',
        groupId: testGroupId,
        newValue: String(testPlayerId),
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      correction: {
        fieldName: string;
        oldValue: string;
        newValue: string;
      };
    };
    expect(body.correction.fieldName).toBe('wolfPartnerId');
    expect(body.correction.oldValue).toBe('null'); // was null before
    expect(body.correction.newValue).toBe(String(testPlayerId));
  });

  it('clears wolfPartnerId to null and returns 201 with oldValue/newValue as string null', async () => {
    // First set a partner
    await db
      .update(wolfDecisions)
      .set({ partnerPlayerId: testPlayerId })
      .where(eq(wolfDecisions.id, testWolfDecisionId));

    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfPartnerId',
        groupId: testGroupId,
        newValue: 'null',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      correction: {
        oldValue: string;
        newValue: string;
      };
    };
    expect(body.correction.oldValue).toBe(String(testPlayerId));
    expect(body.correction.newValue).toBe('null');
  });

  it('returns 404 NOT_FOUND when wolfPartnerId references unknown player', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfPartnerId',
        groupId: testGroupId,
        newValue: '99999',
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND when wolf decision row does not exist for wolfPartnerId', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 17, // no wolf decision seeded for hole 17
        fieldName: 'wolfPartnerId',
        groupId: testGroupId,
        newValue: String(testPlayerId),
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for partial-string wolfPartnerId newValue', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfPartnerId',
        groupId: testGroupId,
        newValue: '42abc',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when groupId is missing for wolfPartnerId', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'wolfPartnerId',
        newValue: String(testPlayerId),
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — fieldName validation
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — fieldName validation', () => {
  it('returns 400 VALIDATION_ERROR for unknown fieldName', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'unknownField',
        playerId: testPlayerId,
        newValue: '4',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/corrections
// ---------------------------------------------------------------------------

describe('GET /rounds/:roundId/corrections', () => {
  it('returns empty items array for round with no corrections', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toEqual([]);
  });

  it('returns corrections in reverse-chronological order', async () => {
    // Insert two corrections with different timestamps
    const t1 = Date.now();
    const t2 = t1 + 1000;

    await db.insert(scoreCorrections).values({
      adminUserId: 1,
      roundId: testRoundId,
      holeNumber: 5,
      playerId: testPlayerId,
      fieldName: 'grossScore',
      oldValue: '5',
      newValue: '4',
      correctedAt: t1,
    });

    await db.insert(scoreCorrections).values({
      adminUserId: 1,
      roundId: testRoundId,
      holeNumber: 5,
      playerId: testPlayerId,
      fieldName: 'grossScore',
      oldValue: '4',
      newValue: '3',
      correctedAt: t2,
    });

    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: { newValue: string; correctedAt: number }[] };
    expect(body.items.length).toBe(2);
    // Most recent first
    expect(body.items[0]!.newValue).toBe('3');
    expect(body.items[1]!.newValue).toBe('4');
    expect(body.items[0]!.correctedAt).toBeGreaterThan(body.items[1]!.correctedAt);
  });

  it('returns adminUsername and playerName in each item', async () => {
    await db.insert(scoreCorrections).values({
      adminUserId: 1,
      roundId: testRoundId,
      holeNumber: 5,
      playerId: testPlayerId,
      fieldName: 'grossScore',
      oldValue: '5',
      newValue: '4',
      correctedAt: Date.now(),
    });

    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: { adminUsername: string; playerName: string | null }[] };
    expect(body.items[0]!.adminUsername).toBe('test-admin-sc');
    expect(body.items[0]!.playerName).toBe('Test Player SC');
  });

  it('returns 404 NOT_FOUND for unknown round', async () => {
    const res = await scoreCorrectionsApp.request('/rounds/99999/corrections', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — greenie
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — greenie', () => {
  // Seed a wolf decision on par-3 hole 6 for greenie tests
  let greenieWolfDecisionId: number;
  beforeAll(async () => {
    const [wd] = await db
      .insert(wolfDecisions)
      .values({
        roundId: testRoundId,
        groupId: testGroupId,
        holeNumber: 6,
        wolfPlayerId: testPlayerId,
        decision: 'alone',
        partnerPlayerId: null,
        bonusesJson: null,
        createdAt: Date.now(),
      })
      .returning();
    greenieWolfDecisionId = wd!.id;
  });

  afterAll(async () => {
    await db.delete(wolfDecisions).where(eq(wolfDecisions.id, greenieWolfDecisionId));
  });

  it('adds a greenie and returns 201', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 6,
        fieldName: 'greenie',
        groupId: testGroupId,
        playerId: testPlayerId,
        newValue: 'add',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { correction: { fieldName: string; newValue: string } };
    expect(body.correction.fieldName).toBe('greenie');
    // newValue in audit log is the resulting array, not 'add'
    expect(body.correction.newValue).toBe(JSON.stringify([testPlayerId]));

    // Verify DB updated
    const wd = await db.select({ bonusesJson: wolfDecisions.bonusesJson }).from(wolfDecisions).where(eq(wolfDecisions.id, greenieWolfDecisionId)).get();
    const bonuses = JSON.parse(wd!.bonusesJson!) as { greenies: number[] };
    expect(bonuses.greenies).toContain(testPlayerId);
  });

  it('removes a greenie and returns 201', async () => {
    // First add
    await db.update(wolfDecisions).set({ bonusesJson: JSON.stringify({ greenies: [testPlayerId], polies: [] }) }).where(eq(wolfDecisions.id, greenieWolfDecisionId));

    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 6,
        fieldName: 'greenie',
        groupId: testGroupId,
        playerId: testPlayerId,
        newValue: 'remove',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { correction: { newValue: string } };
    expect(body.correction.newValue).toBe(JSON.stringify([]));
  });

  it('returns 422 VALIDATION_ERROR for greenie on non-par-3 hole', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'greenie',
        groupId: testGroupId,
        playerId: testPlayerId,
        newValue: 'add',
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — polie
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — polie', () => {
  it('adds a polie on any hole and returns 201', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'polie',
        groupId: testGroupId,
        playerId: testPlayerId,
        newValue: 'add',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { correction: { fieldName: string; newValue: string } };
    expect(body.correction.fieldName).toBe('polie');
    expect(body.correction.newValue).toBe(JSON.stringify([testPlayerId]));

    const wd = await db.select({ bonusesJson: wolfDecisions.bonusesJson }).from(wolfDecisions).where(eq(wolfDecisions.id, testWolfDecisionId)).get();
    const bonuses = JSON.parse(wd!.bonusesJson!) as { polies: number[] };
    expect(bonuses.polies).toContain(testPlayerId);
  });

  it('returns 400 VALIDATION_ERROR for invalid newValue', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'polie',
        groupId: testGroupId,
        playerId: testPlayerId,
        newValue: 'toggle',
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections — handicapIndex
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/corrections — handicapIndex', () => {
  let hiPlayerId: number;

  beforeAll(async () => {
    const [p] = await db.insert(players).values({ name: 'HI Player', createdAt: Date.now() }).returning();
    hiPlayerId = p!.id;
    await db.insert(roundPlayers).values({
      roundId: testRoundId,
      groupId: testGroupId,
      playerId: hiPlayerId,
      handicapIndex: 14.2,
      isSub: 0,
    });
  });

  afterAll(async () => {
    await db.delete(roundPlayers).where(eq(roundPlayers.playerId, hiPlayerId));
    await db.delete(players).where(eq(players.id, hiPlayerId));
  });

  it('updates handicap index and returns 201', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 0,
        fieldName: 'handicapIndex',
        playerId: hiPlayerId,
        newValue: '12.8',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { correction: { fieldName: string; oldValue: string; newValue: string; holeNumber: number } };
    expect(body.correction.fieldName).toBe('handicapIndex');
    expect(body.correction.oldValue).toBe('14.2');
    expect(body.correction.newValue).toBe('12.8');
    expect(body.correction.holeNumber).toBe(0);

    // Verify DB updated
    const rp = await db.select({ handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(eq(roundPlayers.playerId, hiPlayerId))
      .get();
    expect(rp?.handicapIndex).toBe(12.8);
  });

  it('returns 400 VALIDATION_ERROR for out-of-range HI', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 0,
        fieldName: 'handicapIndex',
        playerId: hiPlayerId,
        newValue: '55.0',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when holeNumber is not 0', async () => {
    const res = await scoreCorrectionsApp.request(`/rounds/${testRoundId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holeNumber: 5,
        fieldName: 'handicapIndex',
        playerId: hiPlayerId,
        newValue: '12.0',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
