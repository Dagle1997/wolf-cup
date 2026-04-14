import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { vi } from 'vitest';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
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

import roundsApp from './rounds.js';
import { db } from '../db/index.js';
import { seasons, rounds, groups, roundPlayers, players, holeScores, roundResults, wolfDecisions } from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

const TODAY = new Date().toISOString().slice(0, 10);
const LAST_WEEK = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const ENTRY_CODE = 'WOLF2026';

let seasonId: number;
let officialRoundId: number;
let casualRoundId: number;
let finalizedRoundId: number;
let cancelledRoundId: number;
let oldRoundId: number;
let groupId: number;
let playerId: number;
let entryCodeHash: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  entryCodeHash = await bcrypt.hash(ENTRY_CODE, 10);

  const [season] = await db
    .insert(seasons)
    .values({
      name: '2026',
      year: 3010,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 15,
      playoffFormat: 'top-8',
      harveyLiveEnabled: 0,
      createdAt: Date.now(),
    })
    .returning({ id: seasons.id });
  seasonId = season!.id;

  const [officialRound] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'official',
      status: 'scheduled',
      scheduledDate: TODAY,
      entryCodeHash,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  officialRoundId = officialRound!.id;

  const [casualRound] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'casual',
      status: 'scheduled',
      scheduledDate: TODAY,
      entryCodeHash: null,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  casualRoundId = casualRound!.id;

  const [finalizedRound] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'official',
      status: 'finalized',
      scheduledDate: TODAY,
      entryCodeHash,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  finalizedRoundId = finalizedRound!.id;

  const [cancelledRound] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'official',
      status: 'cancelled',
      scheduledDate: TODAY,
      entryCodeHash: null,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  cancelledRoundId = cancelledRound!.id;

  const [oldRound] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'official',
      status: 'scheduled',
      scheduledDate: LAST_WEEK,
      entryCodeHash,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  oldRoundId = oldRound!.id;

  const [player] = await db
    .insert(players)
    .values({ name: 'Josh Stoll', ghinNumber: '12345', isActive: 1, createdAt: Date.now() })
    .returning({ id: players.id });
  playerId = player!.id;

  const [group] = await db
    .insert(groups)
    .values({ roundId: officialRoundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  groupId = group!.id;

  await db.insert(roundPlayers).values({
    roundId: officialRoundId,
    groupId,
    playerId,
    handicapIndex: 14.2,
    isSub: 0,
  });
});

afterEach(async () => {
  // Reset official round to scheduled after start tests may have changed it
  await db
    .update(rounds)
    .set({ status: 'scheduled', entryCodeHash })
    .where(eq(rounds.id, officialRoundId));
});

// ---------------------------------------------------------------------------
// GET /rounds
// ---------------------------------------------------------------------------

describe('GET /rounds', () => {
  it('returns scheduled and active rounds within date window', async () => {
    const res = await roundsApp.request('/rounds');
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ id: number }> };
    const ids = body.items.map((r) => r.id);
    expect(ids).toContain(officialRoundId);
    expect(ids).toContain(casualRoundId);
  });

  it('excludes finalized, cancelled, and out-of-window rounds', async () => {
    const res = await roundsApp.request('/rounds');
    const body = await res.json() as { items: Array<{ id: number }> };
    const ids = body.items.map((r) => r.id);
    expect(ids).not.toContain(finalizedRoundId);
    expect(ids).not.toContain(cancelledRoundId);
    expect(ids).not.toContain(oldRoundId);
  });

  it('never returns entryCodeHash', async () => {
    const res = await roundsApp.request('/rounds');
    const body = await res.json() as { items: Array<Record<string, unknown>> };
    for (const item of body.items) {
      expect(item).not.toHaveProperty('entryCodeHash');
      expect(item).not.toHaveProperty('entry_code_hash');
    }
  });

  it('returns autoCalculateMoney as boolean', async () => {
    const res = await roundsApp.request('/rounds');
    const body = await res.json() as { items: Array<{ autoCalculateMoney: unknown }> };
    for (const item of body.items) {
      expect(typeof item.autoCalculateMoney).toBe('boolean');
    }
  });

  it('returns rounds ordered by scheduledDate descending', async () => {
    const res = await roundsApp.request('/rounds');
    const body = await res.json() as { items: Array<{ scheduledDate: string }> };
    const dates = body.items.map((r) => r.scheduledDate);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  it('includes active rounds within the date window', async () => {
    // Temporarily set officialRound to active
    await db.update(rounds).set({ status: 'active' }).where(eq(rounds.id, officialRoundId));
    const res = await roundsApp.request('/rounds');
    const body = await res.json() as { items: Array<{ id: number; status: string }> };
    const found = body.items.find((r) => r.id === officialRoundId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('active');
    // afterEach will restore status to 'scheduled'
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:id
// ---------------------------------------------------------------------------

describe('GET /rounds/:id', () => {
  it('returns round with nested groups and players', async () => {
    const res = await roundsApp.request(`/rounds/${officialRoundId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      round: {
        id: number;
        type: string;
        status: string;
        groups: Array<{
          id: number;
          groupNumber: number;
          players: Array<{ id: number; name: string; handicapIndex: number }>;
        }>;
      };
    };
    expect(body.round.id).toBe(officialRoundId);
    expect(body.round.type).toBe('official');
    expect(body.round.groups).toHaveLength(1);
    expect(body.round.groups[0]!.groupNumber).toBe(1);
    expect(body.round.groups[0]!.players).toHaveLength(1);
    expect(body.round.groups[0]!.players[0]!.name).toBe('Josh Stoll');
    expect(body.round.groups[0]!.players[0]!.handicapIndex).toBe(14.2);
  });

  it('returns 404 for non-existent round', async () => {
    const res = await roundsApp.request('/rounds/99999');
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid round id', async () => {
    const res = await roundsApp.request('/rounds/abc');
    expect(res.status).toBe(400);
  });

  it('never returns entryCodeHash', async () => {
    const res = await roundsApp.request(`/rounds/${officialRoundId}`);
    const body = await res.json() as { round: Record<string, unknown> };
    expect(body.round).not.toHaveProperty('entryCodeHash');
    expect(body.round).not.toHaveProperty('entry_code_hash');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/start — casual
// ---------------------------------------------------------------------------

describe('POST /rounds/:id/start — casual round', () => {
  it('returns 200 without any entry code', async () => {
    const res = await roundsApp.request(`/rounds/${casualRoundId}/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { round: { id: number; type: string } };
    expect(body.round.id).toBe(casualRoundId);
    expect(body.round.type).toBe('casual');
  });

  it('ignores any provided entry code for casual rounds', async () => {
    const res = await roundsApp.request(`/rounds/${casualRoundId}/start`, {
      method: 'POST',
      headers: { 'x-entry-code': 'ANYTHING' },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/start — official
// ---------------------------------------------------------------------------

describe('POST /rounds/:id/start — official round', () => {
  it('returns 200 and transitions round to active with valid code', async () => {
    const res = await roundsApp.request(`/rounds/${officialRoundId}/start`, {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { round: { id: number; status: string } };
    expect(body.round.id).toBe(officialRoundId);
    expect(body.round.status).toBe('active');
  });

  it('returns 403 INVALID_ENTRY_CODE with wrong code', async () => {
    const res = await roundsApp.request(`/rounds/${officialRoundId}/start`, {
      method: 'POST',
      headers: { 'x-entry-code': 'WRONGCODE' },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('returns 403 INVALID_ENTRY_CODE with missing code', async () => {
    const res = await roundsApp.request(`/rounds/${officialRoundId}/start`, { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('returns 200 idempotently when round is already active with valid code', async () => {
    // Put round in active state first
    await db.update(rounds).set({ status: 'active' }).where(eq(rounds.id, officialRoundId));
    const res = await roundsApp.request(`/rounds/${officialRoundId}/start`, {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { round: { status: string } };
    expect(body.round.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/start — non-joinable and not-found
// ---------------------------------------------------------------------------

describe('POST /rounds/:id/start — non-joinable rounds', () => {
  it('returns 422 ROUND_NOT_JOINABLE for finalized round', async () => {
    const res = await roundsApp.request(`/rounds/${finalizedRoundId}/start`, {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE },
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_JOINABLE');
  });

  it('returns 422 ROUND_NOT_JOINABLE for cancelled round', async () => {
    const res = await roundsApp.request(`/rounds/${cancelledRoundId}/start`, { method: 'POST' });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_JOINABLE');
  });

  it('returns 404 NOT_FOUND for non-existent round', async () => {
    const res = await roundsApp.request('/rounds/99999/start', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// PUT /rounds/:roundId/groups/:groupId/batting-order
// ---------------------------------------------------------------------------

describe('PUT /rounds/:roundId/groups/:groupId/batting-order', () => {
  // Set up a group with 4 players for these tests
  let p1Id: number;
  let p2Id: number;
  let p3Id: number;
  let p4Id: number;
  let groupOf4Id: number;
  let casualGroupId: number;

  beforeAll(async () => {
    // Create 4 fresh players not in any existing round (avoids unique (round_id, player_id) constraint)
    const [pp1] = await db.insert(players).values({ name: 'Jason Dagle', ghinNumber: '22222', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [pp2] = await db.insert(players).values({ name: 'Rob Bonner', ghinNumber: '33333', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [pp3] = await db.insert(players).values({ name: 'Mike Jaquint', ghinNumber: '44444', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [pp4] = await db.insert(players).values({ name: 'Bill Smith', ghinNumber: '55555', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    p1Id = pp1!.id;
    p2Id = pp2!.id;
    p3Id = pp3!.id;
    p4Id = pp4!.id;

    // Create a group with all 4 players in the official round
    const [g4] = await db.insert(groups).values({ roundId: officialRoundId, groupNumber: 2, battingOrder: null }).returning({ id: groups.id });
    groupOf4Id = g4!.id;
    for (const [pid, hi] of [[p1Id, 14.2], [p2Id, 8.1], [p3Id, 12.0], [p4Id, 6.5]] as const) {
      await db.insert(roundPlayers).values({ roundId: officialRoundId, groupId: groupOf4Id, playerId: pid, handicapIndex: hi, isSub: 0 });
    }

    // Create a group with all 4 players in the casual round
    const [cg] = await db.insert(groups).values({ roundId: casualRoundId, groupNumber: 1, battingOrder: null }).returning({ id: groups.id });
    casualGroupId = cg!.id;
    for (const [pid, hi] of [[p1Id, 14.2], [p2Id, 8.1], [p3Id, 12.0], [p4Id, 6.5]] as const) {
      await db.insert(roundPlayers).values({ roundId: casualRoundId, groupId: casualGroupId, playerId: pid, handicapIndex: hi, isSub: 0 });
    }
  });

  afterEach(async () => {
    // Reset battingOrder after each test
    await db.update(groups).set({ battingOrder: null }).where(eq(groups.id, groupOf4Id));
    await db.update(groups).set({ battingOrder: null }).where(eq(groups.id, casualGroupId));
  });

  it('saves batting order for official round with valid code and returns wolfSchedule', async () => {
    const order = [p1Id, p2Id, p3Id, p4Id];
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      group: {
        id: number;
        groupNumber: number;
        battingOrder: number[];
        wolfSchedule: Array<{ holeNumber: number; type: string; wolfPlayerId: number | null; wolfPlayerName: string | null }>;
      };
    };
    expect(body.group.id).toBe(groupOf4Id);
    expect(body.group.battingOrder).toEqual(order);
    expect(body.group.wolfSchedule).toHaveLength(18);
    // Holes 1 and 3 are skins
    expect(body.group.wolfSchedule[0]!.type).toBe('skins');
    expect(body.group.wolfSchedule[1]!.type).toBe('wolf');
    expect(body.group.wolfSchedule[0]!.wolfPlayerId).toBeNull();
    // Hole 2: batter index 0 → p1Id
    expect(body.group.wolfSchedule[1]!.wolfPlayerId).toBe(p1Id);
    expect(body.group.wolfSchedule[1]!.wolfPlayerName).toBe('Jason Dagle');
    expect(body.group.wolfSchedule[2]!.type).toBe('skins');
    // Hole 4: batter index 1 → p2Id
    expect(body.group.wolfSchedule[3]!.wolfPlayerId).toBe(p2Id);
  });

  it('saves batting order for casual round without entry code', async () => {
    const order = [p2Id, p1Id, p4Id, p3Id];
    const res = await roundsApp.request(
      `/rounds/${casualRoundId}/groups/${casualGroupId}/batting-order`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { group: { battingOrder: number[] } };
    expect(body.group.battingOrder).toEqual(order);
  });

  it('GET /rounds/:roundId/players/:playerId/scorecard includes hole 2 in wolfHoles for batting position 1', async () => {
    const order = [p1Id, p2Id, p3Id, p4Id];
    await db.update(groups).set({ battingOrder: JSON.stringify(order) }).where(eq(groups.id, groupOf4Id));

    const res = await roundsApp.request(`/rounds/${officialRoundId}/players/${p1Id}/scorecard`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      battingPosition: number | null;
      wolfHoles: number[];
    };

    expect(body.battingPosition).toBe(1);
    expect(body.wolfHoles).toEqual([2, 6, 9, 14]);
  });

  it('returns 403 INVALID_ENTRY_CODE for official round with wrong code', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': 'WRONGCODE', 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, p4Id] }),
      },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('returns 403 INVALID_ENTRY_CODE for official round with missing code', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, p4Id] }),
      },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('returns 422 INVALID_BATTING_ORDER for player not in group', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, 99999] }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_BATTING_ORDER');
  });

  it('returns 422 INVALID_BATTING_ORDER for duplicate player IDs', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p1Id, p3Id, p4Id] }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_BATTING_ORDER');
  });

  it('returns 422 INVALID_BATTING_ORDER for wrong player count (3 players)', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id] }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_BATTING_ORDER');
  });

  it('returns 422 INVALID_BATTING_ORDER for wrong player count (5 players)', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, p4Id, p1Id] }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_BATTING_ORDER');
  });

  it('returns 404 for non-existent group', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/99999/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, p4Id] }),
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 when group belongs to a different round', async () => {
    // groupOf4Id belongs to officialRoundId, not casualRoundId
    const res = await roundsApp.request(
      `/rounds/${casualRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, p4Id] }),
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 422 ROUND_NOT_JOINABLE for finalized round', async () => {
    const res = await roundsApp.request(
      `/rounds/${finalizedRoundId}/groups/${groupOf4Id}/batting-order`,
      {
        method: 'PUT',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [p1Id, p2Id, p3Id, p4Id] }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_JOINABLE');
  });

  it('GET /rounds/:id returns battingOrder as number[] after being set', async () => {
    const order = [p3Id, p1Id, p4Id, p2Id];
    // Set the batting order first
    await db.update(groups).set({ battingOrder: JSON.stringify(order) }).where(eq(groups.id, groupOf4Id));
    const res = await roundsApp.request(`/rounds/${officialRoundId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { round: { groups: Array<{ id: number; battingOrder: number[] | null }> } };
    const group4 = body.round.groups.find(g => g.id === groupOf4Id);
    expect(group4).toBeDefined();
    expect(Array.isArray(group4!.battingOrder)).toBe(true);
    expect(group4!.battingOrder).toEqual(order);
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/scores
// GET  /rounds/:roundId/groups/:groupId/scores
// ---------------------------------------------------------------------------

describe('Score entry endpoints', () => {
  let s1Id: number;
  let s2Id: number;
  let s3Id: number;
  let s4Id: number;
  let scoreGroupId: number;
  let casualScoreGroupId: number;

  beforeAll(async () => {
    // Create 4 fresh players for score tests
    const [sp1] = await db.insert(players).values({ name: 'Alice Score', ghinNumber: '66661', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [sp2] = await db.insert(players).values({ name: 'Bob Score', ghinNumber: '66662', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [sp3] = await db.insert(players).values({ name: 'Carol Score', ghinNumber: '66663', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [sp4] = await db.insert(players).values({ name: 'Dave Score', ghinNumber: '66664', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    s1Id = sp1!.id;
    s2Id = sp2!.id;
    s3Id = sp3!.id;
    s4Id = sp4!.id;

    // Group in official round (groupNumber 3 — groups 1 and 2 already created above)
    const [sg] = await db.insert(groups).values({ roundId: officialRoundId, groupNumber: 3, battingOrder: null }).returning({ id: groups.id });
    scoreGroupId = sg!.id;
    for (const [pid, hi] of [[s1Id, 0], [s2Id, 9.0], [s3Id, 18.0], [s4Id, 27.0]] as const) {
      await db.insert(roundPlayers).values({ roundId: officialRoundId, groupId: scoreGroupId, playerId: pid, handicapIndex: hi, isSub: 0 });
    }

    // Group in casual round (groupNumber 2)
    const [csg] = await db.insert(groups).values({ roundId: casualRoundId, groupNumber: 2, battingOrder: null }).returning({ id: groups.id });
    casualScoreGroupId = csg!.id;
    for (const [pid, hi] of [[s1Id, 0], [s2Id, 9.0], [s3Id, 18.0], [s4Id, 27.0]] as const) {
      await db.insert(roundPlayers).values({ roundId: casualRoundId, groupId: casualScoreGroupId, playerId: pid, handicapIndex: hi, isSub: 0 });
    }
  });

  afterEach(async () => {
    await db.delete(holeScores).where(eq(holeScores.roundId, officialRoundId));
    await db.delete(holeScores).where(eq(holeScores.roundId, casualRoundId));
    await db.delete(roundResults).where(eq(roundResults.roundId, officialRoundId));
    await db.delete(roundResults).where(eq(roundResults.roundId, casualRoundId));
  });

  function validScores(ids: [number, number, number, number], score = 4) {
    return ids.map((playerId) => ({ playerId, grossScore: score }));
  }

  it('POST scores: official round with valid code returns 200 and Stableford computed', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      holeScores: Array<{ holeNumber: number; playerId: number; grossScore: number }>;
      roundTotals: Array<{ playerId: number; stablefordTotal: number }>;
    };
    expect(body.holeScores).toHaveLength(4);
    expect(body.roundTotals).toHaveLength(4);
    for (const t of body.roundTotals) {
      expect(typeof t.stablefordTotal).toBe('number');
      expect(t.stablefordTotal).toBeGreaterThanOrEqual(0);
    }
  });

  it('POST scores: casual round returns 200 without entry code', async () => {
    const res = await roundsApp.request(
      `/rounds/${casualRoundId}/groups/${casualScoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { holeScores: unknown[]; roundTotals: unknown[] };
    expect(body.holeScores).toHaveLength(4);
    expect(body.roundTotals).toHaveLength(4);
  });

  it('POST scores: idempotent re-submit overwrites previous score and recomputes', async () => {
    // First submission: grossScore=6
    const first = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/3/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id], 6) }),
      },
    );
    expect(first.status).toBe(200);

    // Second submission on same hole: grossScore=4
    const second = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/3/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id], 4) }),
      },
    );
    expect(second.status).toBe(200);
    const body = await second.json() as {
      holeScores: Array<{ holeNumber: number; grossScore: number }>;
    };
    // All scores for hole 3 should be 4 (overwritten)
    const hole3Scores = body.holeScores.filter((s) => s.holeNumber === 3);
    expect(hole3Scores).toHaveLength(4);
    for (const s of hole3Scores) {
      expect(s.grossScore).toBe(4);
    }
  });

  it('POST scores: wrong entry code returns 403 INVALID_ENTRY_CODE', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': 'WRONGCODE', 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('POST scores: holeNumber out of range (0) returns 400 INVALID_HOLE', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/0/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_HOLE');
  });

  it('POST scores: holeNumber out of range (19) returns 400 INVALID_HOLE', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/19/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_HOLE');
  });

  it('POST scores: grossScore < 1 returns 400 VALIDATION_ERROR', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scores: [
            { playerId: s1Id, grossScore: 0 },
            { playerId: s2Id, grossScore: 4 },
            { playerId: s3Id, grossScore: 4 },
            { playerId: s4Id, grossScore: 4 },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST scores: wrong player count (3) returns 400 VALIDATION_ERROR', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scores: [
            { playerId: s1Id, grossScore: 4 },
            { playerId: s2Id, grossScore: 4 },
            { playerId: s3Id, grossScore: 4 },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST scores: duplicate playerIds returns 422 INVALID_SCORES', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scores: [
            { playerId: s1Id, grossScore: 4 },
            { playerId: s1Id, grossScore: 5 },
            { playerId: s2Id, grossScore: 4 },
            { playerId: s3Id, grossScore: 4 },
          ],
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_SCORES');
  });

  it('POST scores: player not in group returns 422 INVALID_SCORES', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scores: [
            { playerId: s1Id, grossScore: 4 },
            { playerId: s2Id, grossScore: 4 },
            { playerId: s3Id, grossScore: 4 },
            { playerId: 99999, grossScore: 4 },
          ],
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_SCORES');
  });

  it('POST scores: cancelled round returns 422 ROUND_NOT_ACTIVE', async () => {
    const res = await roundsApp.request(
      `/rounds/${cancelledRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_ACTIVE');
  });

  it('POST scores: finalized round returns 422 ROUND_NOT_ACTIVE', async () => {
    const res = await roundsApp.request(
      `/rounds/${finalizedRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_ACTIVE');
  });

  it('POST scores: non-existent group returns 404 NOT_FOUND', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/99999/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('GET scores: returns empty array and empty roundTotals when no holes submitted', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/scores`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { scores: unknown[]; roundTotals: unknown[] };
    expect(body.scores).toEqual([]);
    expect(body.roundTotals).toEqual([]);
  });

  it('GET scores: returns roundTotals with Stableford totals after submission', async () => {
    // Submit a hole first
    await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id]) }),
      },
    );

    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/scores`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      scores: unknown[];
      roundTotals: Array<{ playerId: number; stablefordTotal: number }>;
    };
    expect(body.scores).toHaveLength(4);
    expect(body.roundTotals).toHaveLength(4);
    for (const t of body.roundTotals) {
      expect(typeof t.stablefordTotal).toBe('number');
      expect(t.stablefordTotal).toBeGreaterThanOrEqual(0);
    }
  });

  it('GET scores: returns all submitted hole scores sorted by holeNumber asc then playerId asc', async () => {
    // Submit hole 3 then hole 1 to test sorting
    await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/3/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id], 5) }),
      },
    );
    await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: validScores([s1Id, s2Id, s3Id, s4Id], 4) }),
      },
    );

    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${scoreGroupId}/scores`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      scores: Array<{ holeNumber: number; playerId: number; grossScore: number }>;
    };
    expect(body.scores).toHaveLength(8);
    // First 4 rows should be hole 1, last 4 should be hole 3
    expect(body.scores[0]!.holeNumber).toBe(1);
    expect(body.scores[4]!.holeNumber).toBe(3);
    // Within hole 1, sorted by playerId asc
    const hole1 = body.scores.slice(0, 4);
    const playerIds = hole1.map((s) => s.playerId);
    expect(playerIds).toEqual([...playerIds].sort((a, b) => a - b));
  });

  it('GET scores: returns 404 for non-existent round', async () => {
    const res = await roundsApp.request(`/rounds/99999/groups/${scoreGroupId}/scores`);
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/wolf-decision
// GET  /rounds/:roundId/groups/:groupId/wolf-decisions
// ---------------------------------------------------------------------------

describe('Wolf decision endpoints', () => {
  let w1Id: number;
  let w2Id: number;
  let w3Id: number;
  let w4Id: number;
  let wGroupId: number;
  let wCasualGroupId: number;

  // Batting order: w1Id=bat0(wolf on holes 2,6,9,14), w2Id=bat1(wolf on 4,7,10,16),
  // w3Id=bat2(wolf on 5,11,12,17), w4Id=bat3(wolf on 8,13,15,18)
  const WOLF_HOLE = 5; // wolf is w3Id (battingPos 2)

  beforeAll(async () => {
    const [wp1] = await db.insert(players).values({ name: 'Wolf One', ghinNumber: '77771', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [wp2] = await db.insert(players).values({ name: 'Wolf Two', ghinNumber: '77772', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [wp3] = await db.insert(players).values({ name: 'Wolf Three', ghinNumber: '77773', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    const [wp4] = await db.insert(players).values({ name: 'Wolf Four', ghinNumber: '77774', isActive: 1, createdAt: Date.now() }).returning({ id: players.id });
    w1Id = wp1!.id;
    w2Id = wp2!.id;
    w3Id = wp3!.id;
    w4Id = wp4!.id;

    // Group in official round with batting order set
    const [wg] = await db.insert(groups).values({ roundId: officialRoundId, groupNumber: 4, battingOrder: JSON.stringify([w1Id, w2Id, w3Id, w4Id]) }).returning({ id: groups.id });
    wGroupId = wg!.id;
    for (const [pid, hi] of [[w1Id, 0], [w2Id, 0], [w3Id, 0], [w4Id, 0]] as const) {
      await db.insert(roundPlayers).values({ roundId: officialRoundId, groupId: wGroupId, playerId: pid, handicapIndex: hi, isSub: 0 });
    }

    // Group in casual round
    const [wcg] = await db.insert(groups).values({ roundId: casualRoundId, groupNumber: 3, battingOrder: JSON.stringify([w1Id, w2Id, w3Id, w4Id]) }).returning({ id: groups.id });
    wCasualGroupId = wcg!.id;
    for (const [pid, hi] of [[w1Id, 0], [w2Id, 0], [w3Id, 0], [w4Id, 0]] as const) {
      await db.insert(roundPlayers).values({ roundId: casualRoundId, groupId: wCasualGroupId, playerId: pid, handicapIndex: hi, isSub: 0 });
    }

    // Pre-submit scores for WOLF_HOLE (hole 5) so money can be calculated
    const now = Date.now();
    for (const pid of [w1Id, w2Id, w3Id, w4Id]) {
      await db.insert(holeScores).values({ roundId: officialRoundId, groupId: wGroupId, playerId: pid, holeNumber: WOLF_HOLE, grossScore: 4, createdAt: now, updatedAt: now });
      await db.insert(roundResults).values({ roundId: officialRoundId, playerId: pid, stablefordTotal: 2, moneyTotal: 0, updatedAt: now }).onConflictDoUpdate({ target: [roundResults.roundId, roundResults.playerId], set: { stablefordTotal: 2, updatedAt: now } });
    }
  });

  afterEach(async () => {
    await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, officialRoundId));
    await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, casualRoundId));
  });

  function wolfDecisionUrl(roundId: number, groupId: number, hole: number) {
    return `/rounds/${roundId}/groups/${groupId}/holes/${hole}/wolf-decision`;
  }

  it('POST wolf-decision: official round + valid code + alone → 200 + moneyTotals', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      wolfDecision: { holeNumber: number; decision: string };
      moneyTotals: Array<{ playerId: number; moneyTotal: number }>;
    };
    expect(body.wolfDecision.holeNumber).toBe(WOLF_HOLE);
    expect(body.wolfDecision.decision).toBe('alone');
    expect(body.moneyTotals).toHaveLength(4);
    const totalSum = body.moneyTotals.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(totalSum).toBe(0); // zero-sum
  });

  it('POST wolf-decision: casual round → 200 (no code required)', async () => {
    // First add scores to casual group
    const now = Date.now();
    for (const pid of [w1Id, w2Id, w3Id, w4Id]) {
      await db.insert(holeScores).values({ roundId: casualRoundId, groupId: wCasualGroupId, playerId: pid, holeNumber: WOLF_HOLE, grossScore: 4, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [holeScores.roundId, holeScores.playerId, holeScores.holeNumber], set: { grossScore: 4, updatedAt: now } });
    }
    const res = await roundsApp.request(wolfDecisionUrl(casualRoundId, wCasualGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { wolfDecision: { decision: string } };
    expect(body.wolfDecision.decision).toBe('alone');
    // Cleanup casual scores
    await db.delete(holeScores).where(eq(holeScores.roundId, casualRoundId));
  });

  it('POST wolf-decision: partner with partnerPlayerId → 200', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'partner', partnerPlayerId: w1Id }), // w3Id is wolf, w1Id is partner
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      wolfDecision: { decision: string; partnerPlayerId: number };
      moneyTotals: Array<{ playerId: number; moneyTotal: number }>;
    };
    expect(body.wolfDecision.decision).toBe('partner');
    expect(body.wolfDecision.partnerPlayerId).toBe(w1Id);
    const totalSum = body.moneyTotals.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(totalSum).toBe(0);
  });

  it('POST wolf-decision: idempotent re-submit overwrites', async () => {
    // First: alone
    await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    // Second: partner
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'partner', partnerPlayerId: w4Id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { wolfDecision: { decision: string; partnerPlayerId: number } };
    expect(body.wolfDecision.decision).toBe('partner');
    expect(body.wolfDecision.partnerPlayerId).toBe(w4Id);
  });

  it('POST wolf-decision: wrong entry code → 403 INVALID_ENTRY_CODE', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': 'WRONGCODE', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('POST wolf-decision: decision on skins hole (1) → 422 INVALID_DECISION', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, 1), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_DECISION');
  });

  it('POST wolf-decision: missing decision on wolf hole → 422 INVALID_DECISION', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_DECISION');
  });

  it('POST wolf-decision: partner without partnerPlayerId → 422 INVALID_DECISION', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'partner' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_DECISION');
  });

  it('POST wolf-decision: greenie on non-par-3 hole → 422 INVALID_DECISION', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone', greenies: [w1Id] }), // hole 5 is not par-3
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_DECISION');
  });

  it('POST wolf-decision: invalid playerId in polies → 422 INVALID_DECISION', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone', polies: [99999], sandies: [] }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_DECISION');
  });

  it('POST wolf-decision: finalized round → 422 ROUND_NOT_ACTIVE', async () => {
    const res = await roundsApp.request(wolfDecisionUrl(finalizedRoundId, wGroupId, WOLF_HOLE), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_ACTIVE');
  });

  it('POST wolf-decision: skins hole with polies (no decision) → 200', async () => {
    // Skins hole (hole 3) with just a polie — no decision field
    const res = await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, 3), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ polies: [w1Id], sandies: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { wolfDecision: { holeNumber: number; decision: null } };
    expect(body.wolfDecision.holeNumber).toBe(3);
    expect(body.wolfDecision.decision).toBeNull();
  });

  it('GET wolf-decisions: returns empty array when none recorded', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${wGroupId}/wolf-decisions`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { wolfDecisions: unknown[] };
    expect(body.wolfDecisions).toEqual([]);
  });

  it('GET wolf-decisions: returns recorded decisions sorted by holeNumber', async () => {
    // Submit hole 7 (par-3) then hole 5
    await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, 5), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'alone' }),
    });
    await roundsApp.request(wolfDecisionUrl(officialRoundId, wGroupId, 7), {
      method: 'POST',
      headers: { 'x-entry-code': ENTRY_CODE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'blind_wolf' }),
    });

    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/${wGroupId}/wolf-decisions`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      wolfDecisions: Array<{ holeNumber: number; decision: string | null }>;
    };
    expect(body.wolfDecisions).toHaveLength(2);
    expect(body.wolfDecisions[0]!.holeNumber).toBe(5);
    expect(body.wolfDecisions[0]!.decision).toBe('alone');
    expect(body.wolfDecisions[1]!.holeNumber).toBe(7);
    expect(body.wolfDecisions[1]!.decision).toBe('blind_wolf');
  });

  it('GET wolf-decisions: returns 404 for non-existent group', async () => {
    const res = await roundsApp.request(
      `/rounds/${officialRoundId}/groups/99999/wolf-decisions`,
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Guest player endpoints
// ---------------------------------------------------------------------------

describe('Guest player endpoints', () => {
  let guestGroupId: number;

  beforeAll(async () => {
    // Create a group in the casual round with 0 pre-assigned roster players
    const [g] = await db
      .insert(groups)
      .values({ roundId: casualRoundId, groupNumber: 10, battingOrder: null })
      .returning({ id: groups.id });
    guestGroupId = g!.id;
  });

  afterEach(async () => {
    // Remove any guest players and their round_players entries added during tests
    const guestRows = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.isGuest, 1));
    for (const row of guestRows) {
      await db.delete(roundPlayers).where(eq(roundPlayers.playerId, row.id));
      await db.delete(players).where(eq(players.id, row.id));
    }
  });

  const guestUrl = (roundId: number, gId: number) =>
    `/rounds/${roundId}/groups/${gId}/guests`;

  it('POST guests: casual round → 200 with player id, name, handicapIndex', async () => {
    const res = await roundsApp.request(guestUrl(casualRoundId, guestGroupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John Guest', handicapIndex: 12.4 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { player: { id: number; name: string; handicapIndex: number } };
    expect(body.player.id).toBeGreaterThan(0);
    expect(body.player.name).toBe('John Guest');
    expect(body.player.handicapIndex).toBe(12.4);

    // Verify isGuest=1 in DB
    const row = await db.select({ isGuest: players.isGuest }).from(players).where(eq(players.id, body.player.id)).get();
    expect(row?.isGuest).toBe(1);
  });

  it('POST guests: official round → 422 CASUAL_ONLY', async () => {
    const res = await roundsApp.request(guestUrl(officialRoundId, groupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Guest', handicapIndex: 10 }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CASUAL_ONLY');
  });

  it('POST guests: finalized round → 422 ROUND_NOT_ACTIVE', async () => {
    // Need a group in the finalized round
    const [fg] = await db
      .insert(groups)
      .values({ roundId: finalizedRoundId, groupNumber: 99, battingOrder: null })
      .returning({ id: groups.id });
    const res = await roundsApp.request(guestUrl(finalizedRoundId, fg!.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Guest', handicapIndex: 10 }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_ACTIVE');
    await db.delete(groups).where(eq(groups.id, fg!.id));
  });

  it('POST guests: group full (4 players already) → 422 GROUP_FULL', async () => {
    // Create 4 temporary players flagged as guests so afterEach cleans them up
    for (let i = 1; i <= 4; i++) {
      const [p] = await db
        .insert(players)
        .values({ name: `Temp${i}`, ghinNumber: null, isActive: 1, isGuest: 1, createdAt: Date.now() })
        .returning({ id: players.id });
      await db.insert(roundPlayers).values({
        roundId: casualRoundId,
        groupId: guestGroupId,
        playerId: p!.id,
        handicapIndex: 10,
        isSub: 0,
      });
    }

    const res = await roundsApp.request(guestUrl(casualRoundId, guestGroupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fifth Guest', handicapIndex: 10 }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('GROUP_FULL');
  });

  it('POST guests: empty name → 400 VALIDATION_ERROR', async () => {
    const res = await roundsApp.request(guestUrl(casualRoundId, guestGroupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', handicapIndex: 10 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST guests: whitespace-only name → 400 VALIDATION_ERROR', async () => {
    const res = await roundsApp.request(guestUrl(casualRoundId, guestGroupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ', handicapIndex: 10 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST guests: handicapIndex out of range → 400 VALIDATION_ERROR', async () => {
    const res = await roundsApp.request(guestUrl(casualRoundId, guestGroupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Guest', handicapIndex: 55 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /rounds/:id: guest player appears in group.players after being added', async () => {
    // Add a guest
    const addRes = await roundsApp.request(guestUrl(casualRoundId, guestGroupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Visible Guest', handicapIndex: 8.0 }),
    });
    expect(addRes.status).toBe(200);
    const addBody = await addRes.json() as { player: { id: number } };

    // Verify guest appears in GET /rounds/:id response
    const roundRes = await roundsApp.request(`/rounds/${casualRoundId}`);
    expect(roundRes.status).toBe(200);
    const roundBody = await roundRes.json() as {
      round: { groups: Array<{ id: number; players: Array<{ id: number; name: string }> }> };
    };
    const guestGroup = roundBody.round.groups.find((g) => g.id === guestGroupId);
    expect(guestGroup).toBeDefined();
    const guestPlayer = guestGroup!.players.find((p) => p.id === addBody.player.id);
    expect(guestPlayer).toBeDefined();
    expect(guestPlayer!.name).toBe('Visible Guest');
  });
});
