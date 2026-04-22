import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
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

import ctpApp from './ctp-entries.js';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  players,
  sideGames,
  sideGameCtpEntries,
  holeCompletions,
} from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

const ENTRY_CODE = 'CTP2026';

let seasonId: number;
let officialRoundId: number;
let casualRoundId: number;
let finalizedRoundId: number;
let otherSeasonRoundId: number;   // round where CTP isn't in rotation
let groupId: number;
let group2Id: number;
let otherRoundGroupId: number;
let casualGroupId: number;
let finalizedGroupId: number;
let p1Id: number; // Alice
let p2Id: number; // Bob
let p3Id: number; // Carol
let p4Id: number; // Dan
let strangerPlayerId: number; // not on any round
let ctpSideGameId: number;
let entryCodeHash: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  entryCodeHash = await bcrypt.hash(ENTRY_CODE, 10);

  const [season] = await db
    .insert(seasons)
    .values({
      name: 'ctp-test',
      year: 3040,
      startDate: '2040-01-01',
      endDate: '2040-12-31',
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
      status: 'active',
      scheduledDate: '2040-04-26',
      tee: 'black',
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
      status: 'active',
      scheduledDate: '2040-04-26',
      tee: 'blue',
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
      scheduledDate: '2040-04-19',
      tee: 'black',
      entryCodeHash,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  finalizedRoundId = finalizedRound!.id;

  // A round where CTP is NOT in the rotation (tests CTP_NOT_ACTIVE)
  const [otherRound] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'official',
      status: 'active',
      scheduledDate: '2040-05-03',
      tee: 'black',
      entryCodeHash,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  otherSeasonRoundId = otherRound!.id;

  // Groups
  const [g1] = await db
    .insert(groups)
    .values({ roundId: officialRoundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  groupId = g1!.id;

  const [g2] = await db
    .insert(groups)
    .values({ roundId: officialRoundId, groupNumber: 2, battingOrder: null })
    .returning({ id: groups.id });
  group2Id = g2!.id;

  const [otherG] = await db
    .insert(groups)
    .values({ roundId: otherSeasonRoundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  otherRoundGroupId = otherG!.id;

  const [casualG] = await db
    .insert(groups)
    .values({ roundId: casualRoundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  casualGroupId = casualG!.id;

  const [finalizedG] = await db
    .insert(groups)
    .values({ roundId: finalizedRoundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  finalizedGroupId = finalizedG!.id;

  // Players
  const inserts = await db
    .insert(players)
    .values([
      { name: 'Alice', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Bob', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Carol', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Dan', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Stranger', ghinNumber: null, isActive: 1, createdAt: Date.now() },
    ])
    .returning({ id: players.id });
  [p1Id, p2Id, p3Id, p4Id, strangerPlayerId] = inserts.map((p) => p.id) as [
    number, number, number, number, number,
  ];

  // round_players uniqueness is (roundId, playerId): a player can be on only
  // one group per round. group2Id has no roster — it only serves as a valid
  // groupId FK target for multi-group CTP resolver tests below.
  await db.insert(roundPlayers).values([
    { roundId: officialRoundId, groupId, playerId: p1Id, handicapIndex: 10, isSub: 0 },
    { roundId: officialRoundId, groupId, playerId: p2Id, handicapIndex: 12, isSub: 0 },
    { roundId: officialRoundId, groupId, playerId: p3Id, handicapIndex: 8, isSub: 0 },
    { roundId: officialRoundId, groupId, playerId: p4Id, handicapIndex: 15, isSub: 0 },
  ]);

  // Finalized round roster (so PLAYER_NOT_ON_ROUND doesn't trip for the finalized case)
  // Use Carol only — just needs one seat for the 422 test setup
  await db.insert(roundPlayers).values([
    { roundId: finalizedRoundId, groupId: finalizedGroupId, playerId: p3Id, handicapIndex: 8, isSub: 0 },
  ]);

  // Other round roster
  await db.insert(roundPlayers).values([
    { roundId: otherSeasonRoundId, groupId: otherRoundGroupId, playerId: p1Id, handicapIndex: 10, isSub: 0 },
  ]);

  // Put the "Stranger" player onto group 2 of the official round. This lets
  // us test that a player on the ROUND but NOT in the submitting group is
  // rejected as PLAYER_NOT_ON_ROUND.
  await db.insert(roundPlayers).values([
    { roundId: officialRoundId, groupId: group2Id, playerId: strangerPlayerId, handicapIndex: 11, isSub: 0 },
  ]);

  // CTP side game scheduled for officialRoundId + finalizedRoundId (NOT otherSeasonRoundId)
  const [sg] = await db
    .insert(sideGames)
    .values({
      seasonId,
      name: 'Closest to Pin',
      format: 'Closest tee shot on par 3s',
      calculationType: 'manual',
      scheduledRoundIds: JSON.stringify([officialRoundId, finalizedRoundId]),
      createdAt: Date.now(),
    })
    .returning({ id: sideGames.id });
  ctpSideGameId = sg!.id;
  void ctpSideGameId; // side-game row existence drives the CTP_NOT_ACTIVE check;
  // the endpoint matches on calculationType='manual' + scheduledRoundIds
  // containing the round id.

  // Seed hole_completions for hole 6 + 7 (so valid POSTs can happen)
  await db.insert(holeCompletions).values([
    { roundId: officialRoundId, groupId, holeNumber: 6, completedAt: 1_000 },
    { roundId: officialRoundId, groupId, holeNumber: 7, completedAt: 2_000 },
    { roundId: finalizedRoundId, groupId: finalizedGroupId, holeNumber: 6, completedAt: 1_000 },
    { roundId: otherSeasonRoundId, groupId: otherRoundGroupId, holeNumber: 6, completedAt: 1_000 },
  ]);
});

afterEach(async () => {
  await db.delete(sideGameCtpEntries).where(eq(sideGameCtpEntries.roundId, officialRoundId));
  await db.delete(sideGameCtpEntries).where(eq(sideGameCtpEntries.roundId, finalizedRoundId));
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/ctp-entries
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/ctp-entries — validation + auth', () => {
  it('rejects non-numeric roundId with 400 INVALID_ID', async () => {
    const res = await ctpApp.request('/rounds/abc/ctp-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ID');
  });

  it('returns 404 for unknown round', async () => {
    const res = await ctpApp.request('/rounds/999999/ctp-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 422 ROUND_FINALIZED for a finalized round', async () => {
    const res = await ctpApp.request(`/rounds/${finalizedRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId: finalizedGroupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_FINALIZED');
  });

  it('returns 403 INVALID_ENTRY_CODE for official round with no code header', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ENTRY_CODE');
  });

  it('returns 403 INVALID_ENTRY_CODE for official round with wrong code', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': 'WRONG' },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 VALIDATION_ERROR for missing body fields', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ holeNumber: 6 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for non-par-3 hole number', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 8, winnerPlayerId: null }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 GROUP_NOT_FOUND when group does not belong to round', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId: casualGroupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('GROUP_NOT_FOUND');
  });

  it('returns 422 CTP_NOT_ACTIVE when CTP is not scheduled for this round', async () => {
    const res = await ctpApp.request(`/rounds/${otherSeasonRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId: otherRoundGroupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CTP_NOT_ACTIVE');
  });

  it('returns 422 PLAYER_NOT_ON_ROUND when winnerPlayerId is not in the submitting group (even if on the round)', async () => {
    // strangerPlayerId is on officialRoundId via group 2. POSTing them as the
    // winner for group 1's par 3 should be rejected — CTP winner must have
    // teed off in the submitting group physically.
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: strangerPlayerId }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PLAYER_NOT_ON_ROUND');
  });

  it('returns 422 PLAYER_NOT_ON_ROUND when winnerPlayerId is entirely off the round', async () => {
    // Player exists but has no roundPlayers row on this round at all
    const [nobody] = await db
      .insert(players)
      .values({ name: 'Nobody', ghinNumber: null, isActive: 1, createdAt: Date.now() })
      .returning({ id: players.id });
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: nobody!.id }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PLAYER_NOT_ON_ROUND');
  });

  it('returns 422 HOLE_NOT_COMPLETE when no hole_completions row exists', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 12, winnerPlayerId: null }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('HOLE_NOT_COMPLETE');
  });
});

describe('POST /rounds/:roundId/ctp-entries — create + update', () => {
  it('creates a new entry with a player winner (201)', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: p1Id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      entry: { winnerPlayerId: number; winnerName: string; holeCompletedAt: number; finalizedAt: number | null };
    };
    expect(body.entry.winnerPlayerId).toBe(p1Id);
    expect(body.entry.winnerName).toBe('Alice');
    expect(body.entry.holeCompletedAt).toBe(1_000);
    expect(body.entry.finalizedAt).toBeNull();
  });

  it('creates a "nobody" entry with null winnerPlayerId (201)', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 7, winnerPlayerId: null }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      entry: { winnerPlayerId: number | null; winnerName: string | null };
    };
    expect(body.entry.winnerPlayerId).toBeNull();
    expect(body.entry.winnerName).toBeNull();
  });

  it('updates existing entry (200) and preserves holeCompletedAt', async () => {
    const first = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: p1Id }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { entry: { holeCompletedAt: number } };
    const originalCompletedAt = firstBody.entry.holeCompletedAt;

    const second = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: p2Id }),
    });
    expect(second.status).toBe(200);
    const body = await second.json() as {
      entry: { winnerPlayerId: number; winnerName: string; holeCompletedAt: number };
    };
    expect(body.entry.winnerPlayerId).toBe(p2Id);
    expect(body.entry.winnerName).toBe('Bob');
    expect(body.entry.holeCompletedAt).toBe(originalCompletedAt);
  });

  it('allows changing an existing winner back to "nobody"', async () => {
    await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: p1Id }),
    });
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { entry: { winnerPlayerId: number | null } };
    expect(body.entry.winnerPlayerId).toBeNull();
  });

  it('casual round without entry code is rejected as CTP_NOT_ACTIVE (not in rotation)', async () => {
    // Casual rounds bypass entry-code check by design, but they're never in
    // the CTP rotation, so the CTP_NOT_ACTIVE gate blocks them. This test
    // locks that behavior so a later change to "default CTP to always-on"
    // doesn't silently start accepting CTP on practice rounds.
    const res = await ctpApp.request(`/rounds/${casualRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // no x-entry-code
      body: JSON.stringify({ groupId: casualGroupId, holeNumber: 6, winnerPlayerId: null }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CTP_NOT_ACTIVE');
  });

  it('POST followed by POST updates the same row — 201 then 200, same id, stable createdAt, new winner', async () => {
    // Second POST must reuse the unique-key row (not create a duplicate) and
    // return 200. Together with the "rejects update when existing row has
    // finalizedAt set" test below, this exercises both branches of the
    // atomic onConflictDoUpdate (insert branch and update-where-finalized-is-null branch).
    //
    // Asserts against the DB that createdAt is unchanged — this rules out a
    // bug where the handler DELETE+RE-INSERTs (in which case id and createdAt
    // would change with SQLite AUTOINCREMENT rowid reuse being version-dependent).
    const first = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 7, winnerPlayerId: p3Id }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { entry: { id: number; winnerPlayerId: number } };
    const firstId = firstBody.entry.id;

    // Capture the original createdAt via direct DB read
    const [before] = await db
      .select({ createdAt: sideGameCtpEntries.createdAt })
      .from(sideGameCtpEntries)
      .where(eq(sideGameCtpEntries.id, firstId));
    const originalCreatedAt = before!.createdAt;

    const second = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 7, winnerPlayerId: p4Id }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { entry: { id: number; winnerPlayerId: number } };
    expect(secondBody.entry.id).toBe(firstId);
    expect(secondBody.entry.winnerPlayerId).toBe(p4Id);

    // Only one row exists for this (round, group, hole) — no duplicate created
    const hole7rows = await db
      .select()
      .from(sideGameCtpEntries)
      .where(and(
        eq(sideGameCtpEntries.roundId, officialRoundId),
        eq(sideGameCtpEntries.groupId, groupId),
        eq(sideGameCtpEntries.holeNumber, 7),
      ));
    expect(hole7rows).toHaveLength(1);

    // createdAt is stable across the update — rules out delete+re-insert bug
    expect(hole7rows[0]!.createdAt).toBe(originalCreatedAt);
    // updatedAt moved forward on the second POST
    expect(hole7rows[0]!.updatedAt).toBeGreaterThanOrEqual(originalCreatedAt);
  });

  it('rejects update when existing row has finalizedAt set', async () => {
    // Create, then simulate round finalize
    await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: p1Id }),
    });
    await db
      .update(sideGameCtpEntries)
      .set({ finalizedAt: Date.now() })
      .where(eq(sideGameCtpEntries.roundId, officialRoundId));

    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entry-code': ENTRY_CODE },
      body: JSON.stringify({ groupId, holeNumber: 6, winnerPlayerId: p2Id }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_FINALIZED');
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/ctp-entries
// ---------------------------------------------------------------------------

describe('GET /rounds/:roundId/ctp-entries', () => {
  it('returns 400 for non-numeric roundId', async () => {
    const res = await ctpApp.request('/rounds/abc/ctp-entries');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown round', async () => {
    const res = await ctpApp.request('/rounds/999999/ctp-entries');
    expect(res.status).toBe(404);
  });

  it('returns empty entries and all-null currentWinners when no entries exist', async () => {
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      entries: unknown[];
      currentWinners: Record<string, unknown>;
    };
    expect(body.entries).toHaveLength(0);
    expect(body.currentWinners).toEqual({ 6: null, 7: null, 12: null, 15: null });
  });

  it('returns entries and computes currentWinners from resolvePerHoleWinners', async () => {
    // Seed directly — exercises the resolver, not the POST validation
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values([
      {
        roundId: officialRoundId,
        groupId,
        holeNumber: 6,
        winnerPlayerId: p1Id,
        winnerName: 'Alice',
        holeCompletedAt: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        roundId: officialRoundId,
        groupId,
        holeNumber: 7,
        winnerPlayerId: null,
        winnerName: null,
        holeCompletedAt: 2000,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`);
    const body = await res.json() as {
      entries: Array<{ holeNumber: number; winnerPlayerId: number | null }>;
      currentWinners: Record<string, { playerName: string } | null>;
    };
    expect(body.entries).toHaveLength(2);
    expect(body.currentWinners['6']!.playerName).toBe('Alice');
    expect(body.currentWinners['7']).toBeNull();
    expect(body.currentWinners['12']).toBeNull();
  });

  it('currentWinners picks the entry with the latest holeCompletedAt, not updatedAt (offline-safe)', async () => {
    // Simulate offline backfill:
    //   group 1 played at t=1000 and synced later (updatedAt=5000).
    //   group 2 played at t=2000 and synced promptly (updatedAt=3000).
    // Expected: group 2 wins — hole_completed_at > hole_completed_at — regardless
    // of when the rows were actually written to the DB.
    await db.insert(sideGameCtpEntries).values([
      {
        roundId: officialRoundId,
        groupId,
        holeNumber: 12,
        winnerPlayerId: p1Id,
        winnerName: 'Alice',
        holeCompletedAt: 1000,
        createdAt: 5000,
        updatedAt: 5000, // synced later
      },
      {
        roundId: officialRoundId,
        groupId: group2Id,
        holeNumber: 12,
        winnerPlayerId: p2Id,
        winnerName: 'Bob',
        holeCompletedAt: 2000,
        createdAt: 3000,
        updatedAt: 3000, // synced earlier
      },
    ]);

    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`);
    const body = await res.json() as {
      currentWinners: Record<string, { playerId: number; playerName: string } | null>;
    };
    expect(body.currentWinners['12']!.playerId).toBe(p2Id);
    expect(body.currentWinners['12']!.playerName).toBe('Bob');
  });

  it('live player name is preferred over stored snapshot (handles rename)', async () => {
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values({
      roundId: officialRoundId,
      groupId,
      holeNumber: 15,
      winnerPlayerId: p1Id,
      winnerName: 'Alice (stale snapshot)',
      holeCompletedAt: 1500,
      createdAt: now,
      updatedAt: now,
    });

    const res = await ctpApp.request(`/rounds/${officialRoundId}/ctp-entries`);
    const body = await res.json() as {
      currentWinners: Record<string, { playerName: string } | null>;
    };
    // Live name "Alice" beats the stale snapshot
    expect(body.currentWinners['15']!.playerName).toBe('Alice');
  });
});
