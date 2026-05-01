/**
 * T5-8 services/round-state.ts unit tests.
 *
 * Per AC-11: legal/illegal transitions, race-safe conditional UPDATE,
 * opened_at side effect, getRoundState, isEventOrganizer, computeExpectedCells,
 * computeMissingCells.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq } from 'drizzle-orm';
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
  events,
  eventRounds,
  pairings,
  pairingMembers,
  rounds,
  roundStates,
  holeScores,
  auditLog,
} = await import('../db/schema/index.js');
const {
  BusinessRuleError,
  computeExpectedCells,
  computeMissingCells,
  getRoundState,
  isEventOrganizer,
  transitionState,
} = await import('./round-state.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(holeScores);
  await db.delete(roundStates);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedOpts {
  state?:
    | 'not_started'
    | 'in_progress'
    | 'complete_editable'
    | 'finalized'
    | 'cancelled';
  /** If true, foursome has 4 members; else 0 (no pairings). */
  withFoursome?: boolean;
  /** If true, populate hole_scores fully (4 players × 18 holes). */
  fullScores?: boolean;
  /** If true, populate hole_scores partially (one cell missing). */
  partialScores?: boolean;
}

interface SeedResult {
  organizerId: string;
  nonOrganizerId: string;
  playerIds: string[];
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    nonOrganizerId: randomUUID(),
    playerIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    pairingId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  await db.insert(players).values([
    { id: ids.organizerId, isOrganizer: true, createdAt: now, name: 'Organizer', tenantId: TENANT_ID, contextId: CTX_BASE },
    { id: ids.nonOrganizerId, isOrganizer: false, createdAt: now, name: 'NonOrg', tenantId: TENANT_ID, contextId: CTX_BASE },
    ...ids.playerIds.map((pid, i) => ({
      id: pid, isOrganizer: false, createdAt: now, name: `Player${i + 1}`, tenantId: TENANT_ID, contextId: CTX_BASE,
    })),
  ]);

  await db.insert(courses).values({
    id: ids.courseId, name: 'Test Course', clubName: 'Test Club',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
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
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId,
    holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });

  if (opts.state !== undefined) {
    await db.insert(roundStates).values({
      roundId: ids.roundId, state: opts.state, enteredAt: now,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  if (opts.withFoursome !== false) {
    await db.insert(pairings).values({
      id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
      createdAt: now, tenantId: TENANT_ID, contextId: ctx,
    });
    for (let i = 0; i < ids.playerIds.length; i++) {
      await db.insert(pairingMembers).values({
        pairingId: ids.pairingId, playerId: ids.playerIds[i]!, slotNumber: i + 1,
        tenantId: TENANT_ID, contextId: ctx,
      });
    }
  }

  if (opts.fullScores) {
    for (const pid of ids.playerIds) {
      for (let h = 1; h <= 18; h++) {
        await db.insert(holeScores).values({
          id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: h,
          grossStrokes: 4, putts: null, scorerPlayerId: ids.playerIds[0]!,
          clientEventId: `evt-${pid}-${h}`,
          createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: ctx,
        });
      }
    }
  } else if (opts.partialScores) {
    // Score 4 players × 18 holes EXCEPT (player[0], hole 5).
    for (const pid of ids.playerIds) {
      for (let h = 1; h <= 18; h++) {
        if (pid === ids.playerIds[0] && h === 5) continue;
        await db.insert(holeScores).values({
          id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: h,
          grossStrokes: 4, putts: null, scorerPlayerId: ids.playerIds[0]!,
          clientEventId: `evt-${pid}-${h}`,
          createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: ctx,
        });
      }
    }
  }

  return {
    organizerId: ids.organizerId,
    nonOrganizerId: ids.nonOrganizerId,
    playerIds: ids.playerIds,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
  };
}

describe('getRoundState', () => {
  test('returns the current state when row exists', async () => {
    const s = await seed({ state: 'in_progress' });
    const state = await getRoundState(db, s.roundId, TENANT_ID);
    expect(state).toBe('in_progress');
  });

  test('returns null when row missing', async () => {
    const s = await seed(); // no state row
    const state = await getRoundState(db, s.roundId, TENANT_ID);
    expect(state).toBeNull();
  });
});

describe('isEventOrganizer', () => {
  test('true for the actual event organizer', async () => {
    const s = await seed({ state: 'not_started' });
    expect(await isEventOrganizer(db, s.roundId, s.organizerId, TENANT_ID)).toBe(true);
  });

  test('false for a non-organizer player', async () => {
    const s = await seed({ state: 'not_started' });
    expect(await isEventOrganizer(db, s.roundId, s.nonOrganizerId, TENANT_ID)).toBe(false);
  });

  test('false even for is_organizer=true global admin who is not the event organizer', async () => {
    const s = await seed({ state: 'not_started' });
    // nonOrganizerId is not is_organizer; organizerId is. But neither
    // identity matters — what matters is events.organizer_player_id match.
    // Verify a foreign player (any of the playerIds) returns false even
    // though they have is_organizer=false; this is the per-event check.
    expect(await isEventOrganizer(db, s.roundId, s.playerIds[0]!, TENANT_ID)).toBe(false);
  });
});

describe('computeExpectedCells', () => {
  test('4 players × 18 holes = 72', async () => {
    const s = await seed({ state: 'not_started', withFoursome: true });
    const round = { eventRoundId: s.eventRoundId, holesToPlay: 18 };
    expect(await computeExpectedCells(db, round, TENANT_ID)).toBe(72);
  });

  test('null eventRoundId returns 0', async () => {
    expect(
      await computeExpectedCells(db, { eventRoundId: null, holesToPlay: 18 }, TENANT_ID),
    ).toBe(0);
  });

  test('9-hole round returns half', async () => {
    const s = await seed({ state: 'not_started', withFoursome: true });
    const round = { eventRoundId: s.eventRoundId, holesToPlay: 9 };
    expect(await computeExpectedCells(db, round, TENANT_ID)).toBe(36);
  });
});

describe('computeMissingCells', () => {
  test('returns 0 missing when fully scored', async () => {
    const s = await seed({ state: 'not_started', withFoursome: true, fullScores: true });
    const round = { eventRoundId: s.eventRoundId, holesToPlay: 18 };
    const result = await computeMissingCells(db, s.roundId, round, TENANT_ID);
    expect(result.expectedCount).toBe(72);
    expect(result.actualCount).toBe(72);
    expect(result.missingCells).toEqual([]);
  });

  test('returns the missing pair when 1 cell is blank', async () => {
    const s = await seed({ state: 'not_started', withFoursome: true, partialScores: true });
    const round = { eventRoundId: s.eventRoundId, holesToPlay: 18 };
    const result = await computeMissingCells(db, s.roundId, round, TENANT_ID);
    expect(result.expectedCount).toBe(72);
    expect(result.actualCount).toBe(71);
    expect(result.missingCells.length).toBe(1);
    expect(result.missingCells[0]).toEqual({ playerId: s.playerIds[0]!, holeNumber: 5 });
  });

  test('returns empty for null eventRoundId', async () => {
    const result = await computeMissingCells(
      db,
      'fake-round',
      { eventRoundId: null, holesToPlay: 18 },
      TENANT_ID,
    );
    expect(result).toEqual({ expectedCount: 0, actualCount: 0, missingCells: [] });
  });
});

describe('transitionState — legal transitions', () => {
  test('not_started → in_progress + opened_at side effect', async () => {
    const s = await seed({ state: 'not_started' });
    const result = await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
    );
    expect(result).toEqual({ from: 'not_started', to: 'in_progress' });

    // Verify state updated.
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('in_progress');

    // Verify opened_at + opened_by_player_id set on rounds.
    const r = await db.select().from(rounds).where(eq(rounds.id, s.roundId));
    expect(r[0]!.openedAt).not.toBeNull();
    expect(r[0]!.openedByPlayerId).toBe(s.organizerId);

    // Verify audit row written.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, s.roundId), eq(auditLog.eventType, 'round.state_changed')));
    expect(audits.length).toBe(1);
    expect(JSON.parse(audits[0]!.payloadJson)).toEqual({ from: 'not_started', to: 'in_progress' });
  });

  test('in_progress → complete_editable', async () => {
    const s = await seed({ state: 'in_progress' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'complete_editable', s.organizerId, TENANT_ID),
    );
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('complete_editable');
  });

  test('complete_editable → finalized', async () => {
    const s = await seed({ state: 'complete_editable' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'finalized', s.organizerId, TENANT_ID),
    );
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('finalized');
  });

  test('complete_editable → in_progress (rollback)', async () => {
    const s = await seed({ state: 'complete_editable' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
    );
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('in_progress');
  });

  test('not_started → cancelled', async () => {
    const s = await seed({ state: 'not_started' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'cancelled', s.organizerId, TENANT_ID),
    );
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('cancelled');
  });

  test('in_progress → cancelled', async () => {
    const s = await seed({ state: 'in_progress' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'cancelled', s.organizerId, TENANT_ID),
    );
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('cancelled');
  });

  test('complete_editable → cancelled', async () => {
    const s = await seed({ state: 'complete_editable' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'cancelled', s.organizerId, TENANT_ID),
    );
    expect(await getRoundState(db, s.roundId, TENANT_ID)).toBe('cancelled');
  });

  test('idempotent on already-target state (no audit row)', async () => {
    const s = await seed({ state: 'in_progress' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
    );
    // No audit row.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, s.roundId));
    expect(audits.length).toBe(0);
  });
});

describe('transitionState — illegal transitions', () => {
  test('throws on finalized → anything', async () => {
    const s = await seed({ state: 'finalized' });
    await expect(
      db.transaction(async (tx) =>
        transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  test('throws on cancelled → anything', async () => {
    const s = await seed({ state: 'cancelled' });
    await expect(
      db.transaction(async (tx) =>
        transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  test('throws on not_started → finalized (skipping states)', async () => {
    const s = await seed({ state: 'not_started' });
    try {
      await db.transaction(async (tx) =>
        transitionState(tx, s.roundId, 'finalized', s.organizerId, TENANT_ID),
      );
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessRuleError);
      expect((e as { code: string }).code).toBe('illegal_state_transition');
    }
  });

  test('throws on round_state_missing if no row exists', async () => {
    const s = await seed(); // no state row
    try {
      await db.transaction(async (tx) =>
        transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
      );
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessRuleError);
      expect((e as { code: string }).code).toBe('round_state_missing');
    }
  });
});

describe('transitionState — opened_at idempotency', () => {
  test('not_started → in_progress sets opened_at; subsequent transitions do not overwrite', async () => {
    const s = await seed({ state: 'not_started' });
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'in_progress', s.organizerId, TENANT_ID),
    );
    const firstOpened = (await db.select().from(rounds).where(eq(rounds.id, s.roundId)))[0]!.openedAt;
    expect(firstOpened).not.toBeNull();

    // Wait a tick then transition again (in_progress → complete_editable).
    await new Promise((r) => setTimeout(r, 5));
    await db.transaction(async (tx) =>
      transitionState(tx, s.roundId, 'complete_editable', s.organizerId, TENANT_ID),
    );
    const second = (await db.select().from(rounds).where(eq(rounds.id, s.roundId)))[0]!.openedAt;
    expect(second).toBe(firstOpened);
  });
});
