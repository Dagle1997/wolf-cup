/**
 * T5-5 leaderboard service tests.
 *
 * Mirrors the in-memory libsql + migrate pattern from
 * `apps/tournament-api/src/routes/scores.integration.test.ts`. Each fixture
 * deletes seeded rows in beforeEach to keep the file::memory:?cache=shared
 * client clean.
 *
 * Fixtures (per AC-7):
 *   (a) all-tied-zero: 8 participants, no scores → all rank=1, tiedWith=8
 *   (b) mid-round mixed-thru: 4 participants with varying gross + thru
 *   (c) event-scope across 2 rounds: aggregated gross + thru sums
 *   (d) null handicap_index: gross-based rank still works, net=null
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  groups,
  groupMembers,
  rounds,
  roundStates,
  holeScores,
} = await import('../db/schema/index.js');
const { computeLeaderboard, netForSegment, offLowNetForMatch } = await import('./leaderboard.js');
const { calcCourseHandicap } = await import('../engine/handicap-strokes.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(holeScores);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseTees);
  await db.delete(courseHoles);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedOpts {
  participantCount: number;
  /**
   * Per-player handicap indexes (length must equal participantCount).
   * Pass null for "no handicap on file" → netThroughHole should be null.
   */
  handicapIndexes: Array<number | null>;
  /** Stable round/event ids so callers can post hole_scores deterministically. */
  rounds: Array<{ holesToPlay?: 9 | 18; teeColor?: 'blue' | 'white' }>;
}

interface SeedResult {
  eventId: string;
  /** roundIds in the same order as opts.rounds. */
  roundIds: string[];
  /** Stable participant ids — sorted ASC by uuid for predictable tie order. */
  playerIds: string[];
  /** The single course revision all rounds share. */
  courseRevisionId: string;
}

async function seedEvent(opts: SeedOpts): Promise<SeedResult> {
  const now = Date.now();
  const eventId = randomUUID();
  const ctx = `event:${eventId}`;
  const courseId = randomUUID();
  const courseRevId = randomUUID();
  const organizerId = randomUUID();

  // Create participants. Sort their generated UUIDs so tests can predict the
  // tie-break order (we sort by playerId asc as the deterministic secondary).
  const playerIds = Array.from({ length: opts.participantCount }, () => randomUUID()).sort();

  // Insert organizer first (events.organizer_player_id RESTRICT FK).
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });

  for (let i = 0; i < playerIds.length; i++) {
    await db.insert(players).values({
      id: playerIds[i]!,
      isOrganizer: false,
      createdAt: now,
      name: `Player ${i + 1}`,
      manualHandicapIndex: opts.handicapIndexes[i] ?? null,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId,
    courseId,
    revisionNumber: 1,
    sourceUrl: null,
    extractionDate: null,
    verified: true,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  // Two tees so callers can pick blue or white per round (slope/rating differ).
  await db.insert(courseTees).values([
    {
      id: randomUUID(),
      courseRevisionId: courseRevId,
      teeColor: 'blue',
      rating: 723, // 72.3
      slope: 130,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    },
    {
      id: randomUUID(),
      courseRevisionId: courseRevId,
      teeColor: 'white',
      rating: 705, // 70.5
      slope: 120,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    },
  ]);
  // 18 holes, par 4 each (sums to courseTotal 72), stroke index 1..18.
  // The leaderboard doesn't read course_holes (it allocates net proportionally),
  // but netForSegment needs per-hole stroke index — seed a full SI set.
  await db.insert(courseHoles).values(
    Array.from({ length: 18 }, (_, i) => ({
      id: randomUUID(),
      courseRevisionId: courseRevId,
      holeNumber: i + 1,
      par: 4,
      si: i + 1,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    })),
  );

  await db.insert(events).values({
    id: eventId,
    name: 'Test Event',
    startDate: now,
    endDate: now + 4 * 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Group A',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  for (const pid of playerIds) {
    await db.insert(groupMembers).values({
      groupId,
      playerId: pid,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  const roundIds: string[] = [];
  for (let r = 0; r < opts.rounds.length; r++) {
    const eventRoundId = randomUUID();
    const roundId = randomUUID();
    const ropt = opts.rounds[r]!;
    await db.insert(eventRounds).values({
      id: eventRoundId,
      eventId,
      roundNumber: r + 1,
      roundDate: now + r * 86400000,
      courseRevisionId: courseRevId,
      teeColor: ropt.teeColor ?? 'blue',
      holesToPlay: ropt.holesToPlay ?? 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(rounds).values({
      id: roundId,
      eventId,
      eventRoundId,
      holesToPlay: ropt.holesToPlay ?? 18,
      openedAt: now,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(roundStates).values({
      roundId,
      state: 'in_progress',
      enteredAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    roundIds.push(roundId);
  }

  return { eventId, roundIds, playerIds, courseRevisionId: courseRevId };
}

async function postHoleScore(
  roundId: string,
  playerId: string,
  scorerId: string,
  holeNumber: number,
  grossStrokes: number,
): Promise<void> {
  const now = Date.now();
  await db.insert(holeScores).values({
    id: randomUUID(),
    roundId,
    playerId,
    holeNumber,
    grossStrokes,
    putts: null,
    scorerPlayerId: scorerId,
    clientEventId: `evt-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
}

describe('computeLeaderboard', () => {
  test('(a) all-tied-zero: 8 participants, no scores → all rank=1 tiedWith=8 grossThroughHole=null', async () => {
    const seed = await seedEvent({
      participantCount: 8,
      handicapIndexes: [12.4, 8.2, 18.0, 4.5, 22.1, 0.0, 10.0, 15.5],
      rounds: [{ teeColor: 'blue' }],
    });

    const rows = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { roundId: seed.roundIds[0]!, scope: 'round' },
    );

    expect(rows.length).toBe(8);
    for (const row of rows) {
      expect(row.rank).toBe(1);
      expect(row.tiedWith).toBe(8);
      expect(row.grossThroughHole).toBeNull();
      expect(row.netThroughHole).toBeNull();
      expect(row.throughHole).toBe(0);
    }
    // Deterministic order: sorted by playerId asc when all are unscored.
    const sortedIds = [...seed.playerIds];
    expect(rows.map((r) => r.playerId)).toEqual(sortedIds);
  });

  test('(b) mid-round mixed-thru: gross 16/17/18 thru-4 + gross 38 thru-9, scoring sorted asc', async () => {
    const seed = await seedEvent({
      participantCount: 4,
      handicapIndexes: [10.0, 10.0, 10.0, 10.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [p1, p2, p3, p4] = seed.playerIds;
    const roundId = seed.roundIds[0]!;
    const scorer = seed.playerIds[0]!;

    // p1: gross 16 thru 4 (4+4+4+4)
    for (let h = 1; h <= 4; h++) await postHoleScore(roundId, p1!, scorer, h, 4);
    // p2: gross 17 thru 4 (4+4+4+5)
    for (let h = 1; h <= 4; h++) await postHoleScore(roundId, p2!, scorer, h, h === 4 ? 5 : 4);
    // p3: gross 18 thru 4 (4+5+4+5)
    await postHoleScore(roundId, p3!, scorer, 1, 4);
    await postHoleScore(roundId, p3!, scorer, 2, 5);
    await postHoleScore(roundId, p3!, scorer, 3, 4);
    await postHoleScore(roundId, p3!, scorer, 4, 5);
    // p4: gross 38 thru 9 (mostly bogey)
    for (let h = 1; h <= 9; h++) await postHoleScore(roundId, p4!, scorer, h, h <= 7 ? 4 : 5);
    // 4*7 + 5*2 = 28 + 10 = 38

    const rows = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { roundId, scope: 'round' },
    );

    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.grossThroughHole)).toEqual([16, 17, 18, 38]);
    expect(rows.map((r) => r.throughHole)).toEqual([4, 4, 4, 9]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.tiedWith)).toEqual([1, 1, 1, 1]);
    // Each scored player should also have a non-null net (handicap is 10.0).
    for (const row of rows) expect(row.netThroughHole).not.toBeNull();
    // Story 3-4a: net-to-par = net − par of played holes. This fixture is all
    // par-4, so par-of-played = 4 × throughHole; netToPar must reconcile.
    for (const row of rows) {
      expect(row.netToPar).toBe((row.netThroughHole as number) - 4 * row.throughHole);
    }
  });

  test('(c) event-scope across 2 rounds: aggregated gross + thru sum across rounds', async () => {
    const seed = await seedEvent({
      participantCount: 3,
      handicapIndexes: [10.0, 12.0, 8.0],
      rounds: [{ teeColor: 'blue' }, { teeColor: 'white' }],
    });
    const [p1, p2, p3] = seed.playerIds;
    const [r1, r2] = seed.roundIds;
    const scorer = seed.playerIds[0]!;

    // Round 1 — fully scored 18 holes for all 3.
    // p1: all 4s → 72; p2: all 5s → 90; p3: 4 then 5 alternating → 81
    for (let h = 1; h <= 18; h++) {
      await postHoleScore(r1!, p1!, scorer, h, 4);
      await postHoleScore(r1!, p2!, scorer, h, 5);
      await postHoleScore(r1!, p3!, scorer, h, h % 2 === 0 ? 5 : 4);
    }
    // Round 2 — partial: only first 9 holes scored.
    // p1: all 4s through 9 → 36 thru 9; p2: only 5 holes scored, gross 25; p3: no scores
    for (let h = 1; h <= 9; h++) await postHoleScore(r2!, p1!, scorer, h, 4);
    for (let h = 1; h <= 5; h++) await postHoleScore(r2!, p2!, scorer, h, 5);

    const rows = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { scope: 'event' },
    );
    expect(rows.length).toBe(3);

    const byPlayer = new Map(rows.map((r) => [r.playerId, r]));
    const r1p1 = byPlayer.get(p1!)!;
    const r1p2 = byPlayer.get(p2!)!;
    const r1p3 = byPlayer.get(p3!)!;

    // Aggregated gross across rounds.
    expect(r1p1.grossThroughHole).toBe(72 + 36); // 108
    expect(r1p2.grossThroughHole).toBe(90 + 25); // 115
    expect(r1p3.grossThroughHole).toBe(81); // round 2 had no scores for p3

    // Aggregated throughHole.
    expect(r1p1.throughHole).toBe(18 + 9); // 27
    expect(r1p2.throughHole).toBe(18 + 5); // 23
    expect(r1p3.throughHole).toBe(18);

    // Ranking: p1 (108) < p2 (115); p3 (81) is lowest gross but compared
    // to the full field, gross 81 < 108 < 115 → rank 1, 2, 3 = p3, p1, p2.
    expect(rows.map((r) => r.playerId)).toEqual([p3!, p1!, p2!]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);

    // Net should be non-null for all (all 3 have handicap_index set, both
    // rounds have round-context resolvable).
    for (const row of rows) expect(row.netThroughHole).not.toBeNull();
  });

  test('(d) null handicap_index: netThroughHole=null but gross-based rank still works', async () => {
    const seed = await seedEvent({
      participantCount: 3,
      handicapIndexes: [null, 10.0, 5.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [p1, p2, p3] = seed.playerIds;
    const roundId = seed.roundIds[0]!;
    const scorer = seed.playerIds[0]!;

    // Score all 3 through 9 holes.
    for (let h = 1; h <= 9; h++) {
      await postHoleScore(roundId, p1!, scorer, h, 4); // 36
      await postHoleScore(roundId, p2!, scorer, h, 5); // 45
      await postHoleScore(roundId, p3!, scorer, h, 6); // 54
    }

    const rows = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { roundId, scope: 'round' },
    );

    expect(rows.length).toBe(3);
    const byPlayer = new Map(rows.map((r) => [r.playerId, r]));
    const r1 = byPlayer.get(p1!)!;
    const r2 = byPlayer.get(p2!)!;
    const r3 = byPlayer.get(p3!)!;

    // p1 has null handicap → null net, but real gross.
    expect(r1.handicapIndex).toBeNull();
    expect(r1.grossThroughHole).toBe(36);
    expect(r1.netThroughHole).toBeNull();
    expect(r1.rank).toBe(1);

    // p2 + p3 have handicaps, so net is non-null.
    expect(r2.netThroughHole).not.toBeNull();
    expect(r3.netThroughHole).not.toBeNull();

    // Rank order by gross asc: p1 (36), p2 (45), p3 (54).
    expect(rows.map((r) => r.playerId)).toEqual([p1!, p2!, p3!]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  test('1224-style ranking: two players tied at top → rank 1,1,3 (not 1,1,2)', async () => {
    const seed = await seedEvent({
      participantCount: 3,
      handicapIndexes: [10.0, 10.0, 10.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [p1, p2, p3] = seed.playerIds;
    const roundId = seed.roundIds[0]!;
    const scorer = seed.playerIds[0]!;

    // p1 + p2 both gross 16 thru 4; p3 gross 18 thru 4.
    for (let h = 1; h <= 4; h++) {
      await postHoleScore(roundId, p1!, scorer, h, 4);
      await postHoleScore(roundId, p2!, scorer, h, 4);
      await postHoleScore(roundId, p3!, scorer, h, h === 1 ? 6 : 4);
    }

    const rows = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { roundId, scope: 'round' },
    );

    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.grossThroughHole)).toEqual([16, 16, 18]);
    // Competition (1224) ranking: tied first → rank 1, rank 1, rank 3.
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(rows.map((r) => r.tiedWith)).toEqual([2, 2, 1]);
  });

  test('mixed scored + unscored: scored players get 1..N, unscored share rank N+1', async () => {
    const seed = await seedEvent({
      participantCount: 4,
      handicapIndexes: [10.0, 10.0, 10.0, 10.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [p1, p2] = seed.playerIds;
    const roundId = seed.roundIds[0]!;
    const scorer = seed.playerIds[0]!;

    // Only p1 + p2 score; remaining 2 participants are unscored.
    await postHoleScore(roundId, p1!, scorer, 1, 4);
    await postHoleScore(roundId, p2!, scorer, 1, 5);

    const rows = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { roundId, scope: 'round' },
    );

    expect(rows.length).toBe(4);
    // p1 rank=1, p2 rank=2, p3+p4 share rank=3.
    expect(rows[0]!.playerId).toBe(p1);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.playerId).toBe(p2);
    expect(rows[1]!.rank).toBe(2);
    expect(rows[2]!.rank).toBe(3);
    expect(rows[2]!.tiedWith).toBe(2);
    expect(rows[3]!.rank).toBe(3);
    expect(rows[3]!.tiedWith).toBe(2);
    // Unscored rows have null gross/net + throughHole 0.
    for (const r of rows.slice(2)) {
      expect(r.grossThroughHole).toBeNull();
      expect(r.netThroughHole).toBeNull();
      expect(r.throughHole).toBe(0);
    }
  });
});

describe('netForSegment — the betting engine net contract (P2/D3)', () => {
  const ALL_18 = Array.from({ length: 18 }, (_, i) => i + 1);

  test('net-RECONCILIATION: sum over full 18 === leaderboard netThroughHole', async () => {
    // Two players with different handicaps; reconciliation must hold for both.
    const seed = await seedEvent({
      participantCount: 2,
      handicapIndexes: [12.4, 3.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const scorerId = seed.playerIds[0]!;

    // Post a full 18 for both players (varied gross so net isn't trivially gross).
    const grossByPlayer: Record<string, number[]> = {
      [seed.playerIds[0]!]: [4, 5, 4, 6, 4, 4, 5, 4, 4, 4, 5, 4, 4, 3, 4, 5, 4, 4],
      [seed.playerIds[1]!]: [4, 4, 3, 4, 4, 5, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 3, 4],
    };
    for (const pid of seed.playerIds) {
      for (let h = 1; h <= 18; h++) {
        await postHoleScore(roundId, pid, scorerId, h, grossByPlayer[pid]![h - 1]!);
      }
    }

    const board = await computeLeaderboard(
      { db, tenantId: TENANT_ID },
      seed.eventId,
      { roundId, scope: 'round' },
    );

    for (const pid of seed.playerIds) {
      const seg = await netForSegment({ db, tenantId: TENANT_ID }, {
        roundId,
        playerId: pid,
        holeNumbers: ALL_18,
      });
      const row = board.find((r) => r.playerId === pid)!;
      expect(seg.trust).toBe('ok');
      // The exposure must never drift from the leaderboard's own net.
      expect(seg.total).toBe(row.netThroughHole);
    }
  });

  test('front + back nets sum to the full-18 total (segmentable, Nassau-ready)', async () => {
    const seed = await seedEvent({
      participantCount: 1,
      handicapIndexes: [9.7],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const pid = seed.playerIds[0]!;
    for (let h = 1; h <= 18; h++) await postHoleScore(roundId, pid, pid, h, 5);

    const ctx = { db, tenantId: TENANT_ID };
    const front = await netForSegment(ctx, { roundId, playerId: pid, holeNumbers: ALL_18.slice(0, 9) });
    const back = await netForSegment(ctx, { roundId, playerId: pid, holeNumbers: ALL_18.slice(9) });
    const total = await netForSegment(ctx, { roundId, playerId: pid, holeNumbers: ALL_18 });
    expect(front.total! + back.total!).toBe(total.total);
  });

  test('fail-closed: no handicap on file → trust=no_handicap, total null (FR24)', async () => {
    const seed = await seedEvent({
      participantCount: 1,
      handicapIndexes: [null],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const pid = seed.playerIds[0]!;
    for (let h = 1; h <= 18; h++) await postHoleScore(roundId, pid, pid, h, 4);

    const seg = await netForSegment({ db, tenantId: TENANT_ID }, { roundId, playerId: pid, holeNumbers: ALL_18 });
    expect(seg.trust).toBe('no_handicap');
    expect(seg.total).toBeNull();
  });

  test('incomplete scope → trust=incomplete, total null (FR25)', async () => {
    const seed = await seedEvent({
      participantCount: 1,
      handicapIndexes: [10.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const pid = seed.playerIds[0]!;
    // Only 9 of 18 scored, but the bet scope asks for 18.
    for (let h = 1; h <= 9; h++) await postHoleScore(roundId, pid, pid, h, 4);

    const seg = await netForSegment({ db, tenantId: TENANT_ID }, { roundId, playerId: pid, holeNumbers: ALL_18 });
    expect(seg.trust).toBe('incomplete');
    expect(seg.total).toBeNull();
    expect(seg.perHole.filter((p) => p.net !== null)).toHaveLength(9);
  });
});

describe('offLowNetForMatch — $5/hole match nets OFF THE DIFFERENCE (Josh 2026-06-25)', () => {
  const ALL_18 = Array.from({ length: 18 }, (_, i) => i + 1);
  // Blue tee in the seed: slope 130, rating 72.3, par 72. courseHoles SI = hole number.
  const TEE = { slope: 130, ratingTimes10: 723, coursePar: 72 };

  test('low course-handicap plays scratch; the higher gets only the SPREAD on the hardest holes', async () => {
    // HIs chosen so the two course handicaps clearly differ.
    const seed = await seedEvent({
      participantCount: 2,
      handicapIndexes: [16.0, 4.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const high = seed.playerIds[0]!; // HI 16 → higher CH
    const low = seed.playerIds[1]!;  // HI 4  → lower CH
    const scorerId = seed.playerIds[0]!;
    // Flat gross 5 everywhere keeps the arithmetic hand-checkable.
    for (const pid of seed.playerIds) {
      for (let h = 1; h <= 18; h++) await postHoleScore(roundId, pid, scorerId, h, 5);
    }

    const chHigh = calcCourseHandicap({ handicapIndex: 16.0, ...TEE });
    const chLow = calcCourseHandicap({ handicapIndex: 4.0, ...TEE });
    const spread = chHigh - chLow; // strokes the high player gets in the MATCH
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThanOrEqual(18); // keeps stroke-per-hole in {0,1} for this assertion

    const res = await offLowNetForMatch({ db, tenantId: TENANT_ID }, {
      roundId,
      subjectIds: [high, low],
      holeNumbers: ALL_18,
    });

    // Low man plays scratch in the match: net === gross (5) on every hole.
    expect(res.netPerHoleBySubject[low]).toEqual(ALL_18.map(() => 5));
    expect(res.trustBySubject[low]).toBe('ok');

    // High man receives EXACTLY the spread (not his full handicap): one stroke on
    // the `spread` hardest holes (SI 1..spread === holes 1..spread here), none after.
    const highNet = res.netPerHoleBySubject[high]!;
    let strokesGiven = 0;
    for (let i = 0; i < 18; i++) {
      const expectedStroke = i + 1 <= spread ? 1 : 0; // SI === hole number in this seed
      expect(highNet[i]).toBe(5 - expectedStroke);
      strokesGiven += expectedStroke;
    }
    // The crux: total strokes in the match === the DIFFERENCE, not the high CH.
    expect(strokesGiven).toBe(spread);
    expect(strokesGiven).toBeLessThan(chHigh); // off-the-difference < full-handicap
  });

  test('a subject with no handicap → that subject is null, match stays provisional', async () => {
    const seed = await seedEvent({
      participantCount: 2,
      handicapIndexes: [10.0, null],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const withHcp = seed.playerIds[0]!;
    const noHcp = seed.playerIds[1]!;
    for (const pid of seed.playerIds) {
      for (let h = 1; h <= 18; h++) await postHoleScore(roundId, pid, withHcp, h, 4);
    }

    const res = await offLowNetForMatch({ db, tenantId: TENANT_ID }, {
      roundId,
      subjectIds: [withHcp, noHcp],
      holeNumbers: ALL_18,
    });
    expect(res.trustBySubject[noHcp]).toBe('no_handicap');
    // Ungradeable pair → BOTH subjects null (settlePerHoleMatch returns provisional).
    expect(res.netPerHoleBySubject[noHcp]!.every((v) => v === null)).toBe(true);
    expect(res.netPerHoleBySubject[withHcp]!.every((v) => v === null)).toBe(true);
  });

  test('empty subject set fails closed (no throw) — malformed bet stays provisional', async () => {
    const seed = await seedEvent({
      participantCount: 1,
      handicapIndexes: [10.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const res = await offLowNetForMatch({ db, tenantId: TENANT_ID }, {
      roundId,
      subjectIds: [],
      holeNumbers: ALL_18,
    });
    expect(res.netPerHoleBySubject).toEqual({});
    expect(res.trustBySubject).toEqual({});
  });

  test('equal handicaps → both scratch (the match plays as gross)', async () => {
    const seed = await seedEvent({
      participantCount: 2,
      handicapIndexes: [12.0, 12.0],
      rounds: [{ teeColor: 'blue' }],
    });
    const [roundId] = seed.roundIds as [string];
    const a = seed.playerIds[0]!;
    const b = seed.playerIds[1]!;
    for (let h = 1; h <= 18; h++) {
      await postHoleScore(roundId, a, a, h, 4);
      await postHoleScore(roundId, b, a, h, 5);
    }
    const res = await offLowNetForMatch({ db, tenantId: TENANT_ID }, {
      roundId,
      subjectIds: [a, b],
      holeNumbers: ALL_18,
    });
    // No strokes given either way → net === gross for both.
    expect(res.netPerHoleBySubject[a]).toEqual(ALL_18.map(() => 4));
    expect(res.netPerHoleBySubject[b]).toEqual(ALL_18.map(() => 5));
  });
});
