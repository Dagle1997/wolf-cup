import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  courseHoles,
  courseRevisions,
  courses,
  eventRounds,
  events,
  holeClaimWrites,
  holeScores,
  pairingMembers,
  pairings,
  players,
  roundPins,
  roundStates,
  rounds,
} from '../db/schema/index.js';
import { buildPlayerScorecard, ScorecardDataError } from './scorecard.js';
import { allocateStrokesFromCourseHandicap } from '../engine/handicap-strokes.js';

// Private in-memory DB. NOT file::memory:?cache=shared (leaks across reused
// fork workers — T14-2 lesson) and NOT a temp file (slow under full-suite disk
// contention → spurious 5s timeouts). One client per file ⇒ a single private
// :memory: DB: isolated AND fast.
const client = createClient({ url: ':memory:' });
const db = drizzle(client);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../db/migrations');
const TENANT_ID = 'guyan';
const CTX = 'event:scorecard-svc-test';

// Hole pars (1..18) + stroke index = hole number, so a course handicap of K
// gives a stroke on exactly holes 1..K (deterministic, easy to assert).
const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4] as const;

interface SeedIds {
  targetId: string;
  otherId: string;
  scorerId: string;
  courseRevId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

async function seedRound(opts: { holesToPlay?: 9 | 18; holeCount?: number } = {}): Promise<SeedIds> {
  const now = Date.now();
  const ids: SeedIds = {
    targetId: randomUUID(),
    otherId: randomUUID(),
    scorerId: randomUUID(),
    courseRevId: randomUUID(),
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
  };
  const courseId = randomUUID();
  const pairingId = randomUUID();
  const holesToPlay = opts.holesToPlay ?? 18;
  // holeCount lets a test seed FEWER course_holes than holesToPlay (data-error path).
  const holeCount = opts.holeCount ?? 18;

  for (const [id, name] of [
    [ids.targetId, 'Target'],
    [ids.otherId, 'Other'],
    [ids.scorerId, 'Scorer'],
  ] as const) {
    await db.insert(players).values({
      id,
      isOrganizer: false,
      createdAt: now,
      name,
      manualHandicapIndex: null,
      tenantId: TENANT_ID,
      contextId: CTX,
    });
  }

  await db.insert(courses).values({
    id: courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId,
    courseId,
    revisionNumber: 1,
    sourceUrl: null,
    extractionDate: null,
    verified: false,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  for (let n = 1; n <= holeCount; n++) {
    await db.insert(courseHoles).values({
      id: randomUUID(),
      courseRevisionId: ids.courseRevId,
      holeNumber: n,
      par: PARS[n - 1]!,
      si: n, // stroke index = hole number
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID,
      contextId: CTX,
    });
  }
  await db.insert(events).values({
    id: ids.eventId,
    name: 'Test Event',
    startDate: now,
    endDate: now + 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: ids.scorerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId,
    eventId: ids.eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: ids.courseRevId,
    teeColor: 'blue',
    holesToPlay,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(rounds).values({
    id: ids.roundId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    holesToPlay,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(roundStates).values({
    roundId: ids.roundId,
    state: 'in_progress',
    enteredAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(pairings).values({
    id: pairingId,
    eventRoundId: ids.eventRoundId,
    foursomeNumber: 1,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(pairingMembers).values([
    { pairingId, playerId: ids.targetId, slotNumber: 1, tenantId: TENANT_ID, contextId: CTX },
    { pairingId, playerId: ids.otherId, slotNumber: 2, tenantId: TENANT_ID, contextId: CTX },
  ]);
  return ids;
}

async function pinHandicaps(
  ids: SeedIds,
  perPlayer: Record<string, { hi: number | null; ch: number | null }>,
): Promise<void> {
  await db.insert(roundPins).values({
    roundId: ids.roundId,
    resolvedConfigJson: '{}',
    seedRuleSetRevisionId: null,
    courseRevisionId: ids.courseRevId,
    tee: 'blue',
    perPlayerHandicapsJson: JSON.stringify(perPlayer),
    teamCompositionJson: null,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: CTX,
  });
}

async function score(ids: SeedIds, playerId: string, holeNumber: number, gross: number): Promise<void> {
  const now = Date.now();
  await db.insert(holeScores).values({
    id: randomUUID(),
    roundId: ids.roundId,
    playerId,
    holeNumber,
    grossStrokes: gross,
    putts: null,
    scorerPlayerId: ids.scorerId,
    clientEventId: `svc-${playerId}-${holeNumber}-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
}

async function claim(
  ids: SeedIds,
  playerId: string,
  holeNumber: number,
  claimType: 'greenie' | 'polie' | 'sandie',
  op: 'set' | 'remove',
): Promise<void> {
  await db.insert(holeClaimWrites).values({
    id: randomUUID(),
    roundId: ids.roundId,
    playerId,
    holeNumber,
    claimType,
    op,
    scorerPlayerId: ids.scorerId,
    clientEventId: `claim-${randomUUID()}`,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: CTX,
  });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(holeClaimWrites);
  await db.delete(holeScores);
  await db.delete(roundPins);
  await db.delete(roundStates);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

describe('buildPlayerScorecard', () => {
  test('returns one entry per in-play hole with par + si passthrough (18 holes)', async () => {
    const ids = await seedRound();
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    expect(holes).toHaveLength(18);
    expect(holes.map((h) => h.holeNumber)).toEqual([...Array(18)].map((_, i) => i + 1));
    expect(holes[0]!.par).toBe(PARS[0]);
    expect(holes[2]!.par).toBe(PARS[2]); // hole 3 = par 3
  });

  test('9-hole round returns exactly the front nine (1..9)', async () => {
    const ids = await seedRound({ holesToPlay: 9, holeCount: 9 });
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    expect(holes).toHaveLength(9);
    expect(holes.map((h) => h.holeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('relativeStrokes allocated from pinned ch (ch=5 ⇒ a stroke on holes si≤5)', async () => {
    const ids = await seedRound();
    await pinHandicaps(ids, { [ids.targetId]: { hi: 5.0, ch: 5 } });
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    // si = hole number, so holes 1..5 get 1 stroke, holes 6..18 get 0.
    for (const h of holes) {
      expect(h.relativeStrokes).toBe(h.holeNumber <= 5 ? 1 : 0);
    }
  });

  test('relativeStrokes equals the canonical money-engine kernel (consistency invariant, AC #4)', async () => {
    const ids = await seedRound();
    const ch = 23; // > 18 ⇒ base 1 everywhere + an extra on holes si≤5
    await pinHandicaps(ids, { [ids.targetId]: { hi: 22.0, ch } });
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    // The builder MUST use the same allocation the F1/2v2 money path uses
    // (allocateStrokesFromCourseHandicap), so the board and money never disagree.
    for (const h of holes) {
      expect(h.relativeStrokes).toBe(allocateStrokesFromCourseHandicap(ch, h.holeNumber));
    }
  });

  test('net = gross − relativeStrokes for played holes; unplayed ⇒ gross/net null, strokes still present', async () => {
    const ids = await seedRound();
    await pinHandicaps(ids, { [ids.targetId]: { hi: 5.0, ch: 5 } });
    await score(ids, ids.targetId, 1, 5); // si1 ⇒ 1 stroke ⇒ net 4
    await score(ids, ids.targetId, 10, 4); // si10 ⇒ 0 strokes ⇒ net 4
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    const h1 = holes.find((h) => h.holeNumber === 1)!;
    expect(h1.grossScore).toBe(5);
    expect(h1.relativeStrokes).toBe(1);
    expect(h1.netScore).toBe(4);
    const h10 = holes.find((h) => h.holeNumber === 10)!;
    expect(h10.grossScore).toBe(4);
    expect(h10.relativeStrokes).toBe(0);
    expect(h10.netScore).toBe(4);
    // Unplayed hole 2: gross/net null, but relativeStrokes present (si2 ≤ 5 ⇒ 1).
    const h2 = holes.find((h) => h.holeNumber === 2)!;
    expect(h2.grossScore).toBeNull();
    expect(h2.netScore).toBeNull();
    expect(h2.relativeStrokes).toBe(1);
  });

  test('no-pin fallback: relativeStrokes 0, netScore null even for played holes, gross still shown', async () => {
    const ids = await seedRound(); // no round_pin inserted
    await score(ids, ids.targetId, 1, 5);
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    const h1 = holes.find((h) => h.holeNumber === 1)!;
    expect(h1.grossScore).toBe(5); // gross still shown
    expect(h1.relativeStrokes).toBe(0); // no dots
    expect(h1.netScore).toBeNull(); // honest "net unavailable", NOT net=gross
  });

  test('null pinned ch fallback behaves like no-pin (netScore null)', async () => {
    const ids = await seedRound();
    await pinHandicaps(ids, { [ids.targetId]: { hi: null, ch: null } }); // fail-closed unsettleable
    await score(ids, ids.targetId, 1, 5);
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    const h1 = holes.find((h) => h.holeNumber === 1)!;
    expect(h1.relativeStrokes).toBe(0);
    expect(h1.netScore).toBeNull();
  });

  test('claims fold: latest write per (hole, type) wins; remove ⇒ absent; flags are explicit booleans', async () => {
    const ids = await seedRound();
    await claim(ids, ids.targetId, 3, 'greenie', 'set');
    await claim(ids, ids.targetId, 3, 'polie', 'set');
    await claim(ids, ids.targetId, 7, 'sandie', 'set');
    await claim(ids, ids.targetId, 3, 'greenie', 'remove'); // later ⇒ greenie hole 3 absent
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    const h3 = holes.find((h) => h.holeNumber === 3)!;
    expect(h3.hasGreenie).toBe(false); // removed
    expect(h3.hasPolie).toBe(true);
    expect(h3.hasSandie).toBe(false);
    const h7 = holes.find((h) => h.holeNumber === 7)!;
    expect(h7.hasSandie).toBe(true);
    // Flags are always explicit booleans (never undefined) on a no-claim hole.
    const h1 = holes.find((h) => h.holeNumber === 1)!;
    expect(h1.hasGreenie).toBe(false);
    expect(h1.hasPolie).toBe(false);
    expect(h1.hasSandie).toBe(false);
  });

  test("a claim only restricted to this player — another player's claim does not leak", async () => {
    const ids = await seedRound();
    await claim(ids, ids.otherId, 5, 'greenie', 'set'); // OTHER player's claim
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    expect(holes.find((h) => h.holeNumber === 5)!.hasGreenie).toBe(false);
  });

  test('moneyNet is null on every hole (Story 3-3 seam, never fabricated)', async () => {
    const ids = await seedRound();
    await pinHandicaps(ids, { [ids.targetId]: { hi: 5.0, ch: 5 } });
    await score(ids, ids.targetId, 1, 4);
    const holes = await buildPlayerScorecard(db, {
      roundId: ids.roundId,
      playerId: ids.targetId,
      tenantId: TENANT_ID,
    });
    expect(holes.every((h) => h.moneyNet === null)).toBe(true);
  });

  test('throws ScorecardDataError when a course_hole is missing for an in-play hole', async () => {
    // 18-hole round but only 17 course_holes seeded ⇒ hole 18 has no par/si.
    const ids = await seedRound({ holesToPlay: 18, holeCount: 17 });
    await expect(
      buildPlayerScorecard(db, {
        roundId: ids.roundId,
        playerId: ids.targetId,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(ScorecardDataError);
  });
});
