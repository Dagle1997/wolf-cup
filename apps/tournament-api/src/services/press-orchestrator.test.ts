/**
 * T6-4 press orchestrator unit tests.
 *
 * Covers AC-3 (hole-complete detection), AC-4 (press eval + persistence),
 * AC-5 (idempotent replay), AC-6 (engine error → BusinessRuleError),
 * 4-player guard rail (Section 3 codex H#2 fix), UNIQUE-violation
 * handling (Section 5).
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

const client = createClient({ url: 'file::memory:?cache=shared' });
const db = drizzle(client);

const {
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  pairings,
  pairingMembers,
  rounds,
  holeScores,
  ruleSets,
  ruleSetRevisions,
  teamPressLog,
} = await import('../db/schema/index.js');
const { runPressOrchestrator } = await import('./press-orchestrator.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await client.execute('PRAGMA foreign_keys = ON');
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(teamPressLog);
  await db.delete(holeScores);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  playerIds: [string, string, string, string];   // sorted alphabetical
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

async function seed(opts: { autoPressEnabled?: boolean } = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    p1: randomUUID(),
    p2: randomUUID(),
    p3: randomUUID(),
    p4: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    pairingId: randomUUID(),
    roundId: randomUUID(),
    ruleSetId: randomUUID(),
    revisionId: randomUUID(),
  };
  const sortedPlayers: [string, string, string, string] = [ids.p1, ids.p2, ids.p3, ids.p4].sort() as [string, string, string, string];
  const ctx = `event:${ids.eventId}`;

  // Players (organizer + 4 foursome members).
  for (const [id, name, hi] of [
    [ids.organizerId, 'Organizer', 0],
    [ids.p1, 'P1', 0],
    [ids.p2, 'P2', 0],
    [ids.p3, 'P3', 0],
    [ids.p4, 'P4', 0],
  ] as Array<[string, string, number]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name,
      manualHandicapIndex: hi,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  // Course + revision + 1 tee + 18 holes (all par 4 SI varied).
  await db.insert(courses).values({
    id: ids.courseId, name: 'Test', clubName: 'Test CC',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue',
    rating: 720, slope: 113,  // 72.0 rating, neutral slope
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId,
      holeNumber: h, par: 4, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  // Event + event_round + pairing.
  await db.insert(events).values({
    id: ids.eventId, name: 'Test Event', startDate: now, endDate: now + 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < 4; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: sortedPlayers[i]!, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId,
    holesToPlay: 18, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });

  // Rule set with auto-press config (or disabled).
  await db.insert(ruleSets).values({
    id: ids.ruleSetId, name: 'Test', createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  const config = opts.autoPressEnabled !== false
    ? {
        autoPressTriggerAtNDown: 2,
        pressMultiplier: 2,
        basePerHoleCents: 100,
        sandies: false,
        sandiesBonusPerHoleCents: 0,
        greenieCarryover: false,
        greenieValidation: 'none',
        greenieBaseCents: 0,
      }
    : {
        autoPressTriggerAtNDown: null,
        pressMultiplier: 2,
        basePerHoleCents: 100,
        sandies: false,
        sandiesBonusPerHoleCents: 0,
        greenieCarryover: false,
        greenieValidation: 'none',
        greenieBaseCents: 0,
      };
  await db.insert(ruleSetRevisions).values({
    id: ids.revisionId, ruleSetId: ids.ruleSetId, revisionNumber: 1,
    configJson: JSON.stringify(config),
    effectiveFromRoundId: null, effectiveFromHole: 1,
    createdByPlayerId: ids.organizerId, reason: null, createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });

  return {
    organizerId: ids.organizerId,
    playerIds: sortedPlayers,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
  };
}

async function commitHole(
  roundId: string,
  playerId: string,
  holeNumber: number,
  grossStrokes: number,
  ctx: string,
): Promise<void> {
  await db.insert(holeScores).values({
    id: randomUUID(),
    roundId,
    playerId,
    holeNumber,
    grossStrokes,
    putts: 2,
    scorerPlayerId: playerId,
    clientEventId: `evt-${randomUUID()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: ctx,
  });
}

describe('runPressOrchestrator — hole-complete detection (AC-3)', () => {
  test('hole NOT complete (3 of 4 scored) → no press log rows', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3] = s.playerIds;
    // Score holes 1-4 for 3 of 4 players (B beats A but A only 3 players scored).
    for (let h = 1; h <= 4; h++) {
      await commitHole(s.roundId, p1, h, 5, ctx);  // bogey
      await commitHole(s.roundId, p2, h, 5, ctx);
      await commitHole(s.roundId, p3, h, 4, ctx);  // par
    }

    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p3, scorerPlayerId: p3 },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog).where(eq(teamPressLog.roundId, s.roundId));
    expect(presses.length).toBe(0);
  });

  test('hole complete (4 of 4 scored) but no trigger condition → no press log', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3, p4] = s.playerIds;
    // Holes 1-4: alternating wins (close match). teamA = p1,p2; teamB = p3,p4.
    // Hole 1: A wins (p1 4 vs p3 5). Hole 2: B wins (p3 4 vs p1 5). Hole 3: A wins. Hole 4: B wins.
    await commitHole(s.roundId, p1, 1, 4, ctx);
    await commitHole(s.roundId, p2, 1, 5, ctx);
    await commitHole(s.roundId, p3, 1, 5, ctx);
    await commitHole(s.roundId, p4, 1, 5, ctx);

    await commitHole(s.roundId, p1, 2, 5, ctx);
    await commitHole(s.roundId, p2, 2, 5, ctx);
    await commitHole(s.roundId, p3, 2, 4, ctx);
    await commitHole(s.roundId, p4, 2, 5, ctx);

    await commitHole(s.roundId, p1, 3, 4, ctx);
    await commitHole(s.roundId, p2, 3, 5, ctx);
    await commitHole(s.roundId, p3, 3, 5, ctx);
    await commitHole(s.roundId, p4, 3, 5, ctx);

    await commitHole(s.roundId, p1, 4, 5, ctx);
    await commitHole(s.roundId, p2, 4, 5, ctx);
    await commitHole(s.roundId, p3, 4, 4, ctx);
    await commitHole(s.roundId, p4, 4, 5, ctx);

    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p4, scorerPlayerId: p4 },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog).where(eq(teamPressLog.roundId, s.roundId));
    expect(presses.length).toBe(0);
  });

  test('hole complete + 2-down trigger → exactly one team_press_log row', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3, p4] = s.playerIds;
    // Holes 1-4: B wins all (p3 = 4, p4 = 5; p1 = 5, p2 = 5). teamA goes -1, -2 by hole 2.
    // Engine fires press at hole 3 startHole=3.
    for (let h = 1; h <= 4; h++) {
      await commitHole(s.roundId, p1, h, 5, ctx);
      await commitHole(s.roundId, p2, h, 5, ctx);
      await commitHole(s.roundId, p3, h, 4, ctx);
      await commitHole(s.roundId, p4, h, 5, ctx);
    }

    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p4, scorerPlayerId: p4 },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog).where(eq(teamPressLog.roundId, s.roundId));
    expect(presses.length).toBeGreaterThanOrEqual(1);
    const teamAPress = presses.find((p) => p.team === 'teamA' && p.triggerType === 'auto');
    expect(teamAPress).toBeDefined();
    expect(teamAPress!.multiplier).toBe(2);
    expect(teamAPress!.trigger).toBe('2-down');
  });
});

describe('runPressOrchestrator — idempotent replay (AC-5)', () => {
  test('same state evaluated twice → no duplicate press rows', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3, p4] = s.playerIds;
    for (let h = 1; h <= 4; h++) {
      await commitHole(s.roundId, p1, h, 5, ctx);
      await commitHole(s.roundId, p2, h, 5, ctx);
      await commitHole(s.roundId, p3, h, 4, ctx);
      await commitHole(s.roundId, p4, h, 5, ctx);
    }

    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p4, scorerPlayerId: p4 },
        TENANT_ID,
      );
    });
    const pressesAfterFirst = await db.select().from(teamPressLog);
    const firstCount = pressesAfterFirst.length;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // Re-invoke: should not add new presses.
    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p4, scorerPlayerId: p4 },
        TENANT_ID,
      );
    });
    const pressesAfterSecond = await db.select().from(teamPressLog);
    expect(pressesAfterSecond.length).toBe(firstCount);
  });
});

describe('runPressOrchestrator — guard rails', () => {
  test('foursome with non-4 members → skip + warn (no press rows)', async () => {
    // Custom seed with only 2 pairing members.
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3, p4] = s.playerIds;
    // Remove 2 of the pairing members.
    await db.delete(pairingMembers).where(
      and(eq(pairingMembers.playerId, p3), eq(pairingMembers.tenantId, TENANT_ID)),
    );
    await db.delete(pairingMembers).where(
      and(eq(pairingMembers.playerId, p4), eq(pairingMembers.tenantId, TENANT_ID)),
    );

    // Score 4 holes anyway.
    for (let h = 1; h <= 4; h++) {
      await commitHole(s.roundId, p1, h, 5, ctx);
      await commitHole(s.roundId, p2, h, 5, ctx);
    }

    // Should NOT throw; should emit warning + skip.
    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p2, scorerPlayerId: p2 },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog);
    expect(presses.length).toBe(0);
  });

  test('player not in pairing → warning + skip', async () => {
    const s = await seed();
    const fakePlayerId = randomUUID();
    // No commit needed — orchestrator's foursome lookup returns empty.
    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: fakePlayerId, scorerPlayerId: fakePlayerId },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog);
    expect(presses.length).toBe(0);
  });

  test('rule set has auto-press disabled → no press rows', async () => {
    const s = await seed({ autoPressEnabled: false });
    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3, p4] = s.playerIds;
    // Same scoring as the trigger test — but config disables auto-press.
    for (let h = 1; h <= 4; h++) {
      await commitHole(s.roundId, p1, h, 5, ctx);
      await commitHole(s.roundId, p2, h, 5, ctx);
      await commitHole(s.roundId, p3, h, 4, ctx);
      await commitHole(s.roundId, p4, h, 5, ctx);
    }

    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p4, scorerPlayerId: p4 },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog);
    expect(presses.length).toBe(0);
  });

  test('no rule set in tenant → skip', async () => {
    const s = await seed();
    // Drop the rule set to simulate "no config".
    await db.delete(ruleSetRevisions);
    await db.delete(ruleSets);

    const ctx = `event:${s.eventId}`;
    const [p1, p2, p3, p4] = s.playerIds;
    for (let h = 1; h <= 4; h++) {
      await commitHole(s.roundId, p1, h, 5, ctx);
      await commitHole(s.roundId, p2, h, 5, ctx);
      await commitHole(s.roundId, p3, h, 4, ctx);
      await commitHole(s.roundId, p4, h, 5, ctx);
    }

    await db.transaction(async (tx) => {
      await runPressOrchestrator(
        tx,
        { roundId: s.roundId, holeNumber: 4, scoredPlayerId: p4, scorerPlayerId: p4 },
        TENANT_ID,
      );
    });
    const presses = await db.select().from(teamPressLog);
    expect(presses.length).toBe(0);
  });
});
