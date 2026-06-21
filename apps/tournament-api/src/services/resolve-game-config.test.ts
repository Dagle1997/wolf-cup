/**
 * resolve-game-config.test.ts (Story 1.3) — the cascade-resolver service.
 *
 * Asserts: a seeded event default resolves with 0 taps (returns the event
 * config) — locked event yields a foursome's config (zero-tap inherit);
 * most-specific-wins when unlocked; an ORPHAN round row (no event row) is
 * rejected as unsettleable (no_event_level_config), not silently settled; a
 * CROSS-EVENT roundId is rejected (hierarchy) BEFORE any config is loaded (no
 * leak).
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rmSync } = await import('node:fs');
  const dbPath = join(tmpdir(), `gcresolve-${process.pid}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${dbPath}${suffix}`); } catch { /* fresh file */ }
  }
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const schema = await import('../db/schema/index.js');
const {
  events,
  eventRounds,
  rounds,
  pairings,
  pairingMembers,
  players,
  courses,
  courseRevisions,
  gameConfig,
} = schema;
const { resolveEventGameConfig } = await import('./resolve-game-config.js');

const TENANT = 'guyan';

type GuyanConfig = {
  game: string;
  pointValueSchedule: { kind: 'flat'; cents: number };
  modifiers: Array<{ type: string; enabled: boolean; variant?: { basis: string; bonus: string } }>;
  lockState: 'locked' | 'unlocked';
  configVersion: number;
};

function cfg(cents: number, lockState: 'locked' | 'unlocked'): GuyanConfig {
  return {
    game: 'guyan-2v2',
    pointValueSchedule: { kind: 'flat', cents },
    modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
    lockState,
    configVersion: 1,
  };
}

let organizerId: string;
let courseRevisionId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(gameConfig);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);

  organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId, isOrganizer: true, createdAt: 1, name: 'Org', tenantId: TENANT, contextId: 'league:guyan',
  });
  const courseId = randomUUID();
  courseRevisionId = randomUUID();
  await db.insert(courses).values({ id: courseId, name: 'Pete Dye', clubName: 'The Resort', createdAt: 1, tenantId: TENANT, contextId: `library:${TENANT}` });
  await db.insert(courseRevisions).values({
    id: courseRevisionId, courseId, revisionNumber: 1, outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: 1, tenantId: TENANT, contextId: `library:${TENANT}`,
  });
});

/** Seed an event + one event_round + scoring round + a foursome (pairing #1). */
async function seedEvent(): Promise<{ eventId: string; eventRoundId: string; roundId: string; pairingId: string }> {
  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId, name: 'E', startDate: 1, endDate: 2, timezone: 'America/New_York',
    organizerPlayerId: organizerId, createdAt: 1, tenantId: TENANT, contextId: `event:${eventId}`,
  });
  const eventRoundId = randomUUID();
  await db.insert(eventRounds).values({
    id: eventRoundId, eventId, roundNumber: 1, roundDate: 1, courseRevisionId, teeColor: 'Dye',
    holesToPlay: 18, createdAt: 1, tenantId: TENANT, contextId: `event:${eventId}`,
  });
  const roundId = randomUUID();
  await db.insert(rounds).values({
    id: roundId, eventId, eventRoundId, holesToPlay: 18, createdAt: 1, tenantId: TENANT, contextId: `event:${eventId}`,
  });
  const pairingId = randomUUID();
  await db.insert(pairings).values({
    id: pairingId, eventRoundId, foursomeNumber: 1, locked: false, createdAt: 1, tenantId: TENANT, contextId: `event:${eventId}`,
  });
  return { eventId, eventRoundId, roundId, pairingId };
}

async function insertConfig(level: 'event' | 'round' | 'foursome', refId: string, c: GuyanConfig) {
  await db.insert(gameConfig).values({
    id: randomUUID(), level, refId, configJson: JSON.stringify(c),
    lockState: c.lockState, configVersion: c.configVersion,
    createdAt: 1, updatedAt: 1, tenantId: TENANT, contextId: 'event:x',
  });
}

describe('resolveEventGameConfig — happy paths', () => {
  test('event default resolves with 0 taps (event only)', async () => {
    const { eventId } = await seedEvent();
    await insertConfig('event', eventId, cfg(500, 'locked'));
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.game).toBe('guyan-2v2');
    expect(res.config.pointValueSchedule).toEqual({ kind: 'flat', cents: 500 });
  });

  test('locked event: a foursome inherits the event config (zero-tap)', async () => {
    const { eventId, roundId } = await seedEvent();
    await insertConfig('event', eventId, cfg(500, 'locked'));
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT, roundId, foursomeNumber: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Locked → lower-level overrides ignored; event config wins.
    expect((res.config.pointValueSchedule as { cents: number }).cents).toBe(500);
  });

  test('unlocked event: most-specific (round) wins over event', async () => {
    const { eventId, roundId } = await seedEvent();
    await insertConfig('event', eventId, cfg(500, 'unlocked'));
    await insertConfig('round', roundId, cfg(1000, 'unlocked'));
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT, roundId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.config.pointValueSchedule as { cents: number }).cents).toBe(1000);
  });
});

describe('resolveEventGameConfig — fail-closed', () => {
  test('ORPHAN round row (no event row) → unsettleable, not silently settled', async () => {
    const { eventId, roundId } = await seedEvent();
    // round-level row but NO event-level row.
    await insertConfig('round', roundId, cfg(500, 'unlocked'));
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT, roundId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe('unsettleable');
    expect(res.reason).toBe('no_event_level_config');
  });

  test('CROSS-EVENT roundId is rejected (hierarchy) before loading config', async () => {
    const a = await seedEvent();
    const b = await seedEvent();
    await insertConfig('event', a.eventId, cfg(500, 'locked'));
    // Ask for event A but pass round B's id → must reject, not leak B's config.
    const res = await resolveEventGameConfig(db, { eventId: a.eventId, tenantId: TENANT, roundId: b.roundId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe('hierarchy');
    expect(res.reason).toBe('round_not_in_event');
  });

  test('foursomeNumber not in the round is rejected (hierarchy)', async () => {
    const { eventId, roundId } = await seedEvent();
    await insertConfig('event', eventId, cfg(500, 'locked'));
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT, roundId, foursomeNumber: 99 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe('hierarchy');
    expect(res.reason).toBe('foursome_not_in_round');
  });

  test('a corrupt config_json yields unsettleable (corrupt_config), not a 500/throw', async () => {
    const { eventId } = await seedEvent();
    // Write an event-level row whose config_json is non-JSON directly.
    await db.insert(gameConfig).values({
      id: randomUUID(), level: 'event', refId: eventId, configJson: '{not json',
      lockState: 'locked', configVersion: 1,
      createdAt: 1, updatedAt: 1, tenantId: TENANT, contextId: `event:${eventId}`,
    });
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe('unsettleable');
    expect(res.reason).toBe('corrupt_config');
  });

  test('foursomeNumber without roundId is rejected', async () => {
    const { eventId } = await seedEvent();
    await insertConfig('event', eventId, cfg(500, 'locked'));
    const res = await resolveEventGameConfig(db, { eventId, tenantId: TENANT, foursomeNumber: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe('hierarchy');
    expect(res.reason).toBe('foursome_requires_round');
  });
});
