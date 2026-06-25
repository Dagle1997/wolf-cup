/**
 * pin-round-at-start.test.ts (Story 1.4, Task 2 / AC5) — the round-start pin
 * computation: resolves the event config, computes per-player CH ONCE from the
 * effective HI (locked snapshot if H1-locked, else manual), and freezes it into
 * the immutable round_pin. Audits the money-affecting input (AC14).
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db };
});

const { db, client } = await import('../db/index.js');
const {
  players, courses, courseRevisions, courseTees, courseHoles, events, eventRounds,
  pairings, pairingMembers, rounds, gameConfig, roundPins, eventHandicaps, auditLog,
} = await import('../db/schema/index.js');
const { pinRoundAtStart } = await import('./pin-round-at-start.js');

const TENANT = 'guyan';

async function seed(opts: { withEventConfig?: boolean; lockHandicaps?: Record<string, number> } = {}) {
  const now = Date.now();
  const id = {
    p1: randomUUID(), p2: randomUUID(), p3: randomUUID(), p4: randomUUID(),
    eventId: randomUUID(), courseId: randomUUID(), courseRevId: randomUUID(),
    eventRoundId: randomUUID(), pairingId: randomUUID(), roundId: randomUUID(),
  };
  const ps = [id.p1, id.p2, id.p3, id.p4];
  const ctx = `event:${id.eventId}`;
  // Distinct manual HIs so CH differs per player.
  const hi = [10.0, 5.0, 20.0, 0.0];
  for (let i = 0; i < 4; i++) {
    await db.insert(players).values({ id: ps[i]!, isOrganizer: false, createdAt: now, name: `P${i}`, manualHandicapIndex: hi[i]!, tenantId: TENANT, contextId: ctx });
  }
  await db.insert(courses).values({ id: id.courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseRevisions).values({ id: id.courseRevId, courseId: id.courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseTees).values({ id: randomUUID(), courseRevisionId: id.courseRevId, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT, contextId: ctx });
  for (let h = 1; h <= 18; h++) await db.insert(courseHoles).values({ id: randomUUID(), courseRevisionId: id.courseRevId, holeNumber: h, par: 4, si: h, yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx });
  await db.insert(events).values({ id: id.eventId, name: 'E', startDate: now, endDate: now + 1, timezone: 'America/New_York', organizerPlayerId: ps[0]!, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(eventRounds).values({ id: id.eventRoundId, eventId: id.eventId, roundNumber: 1, roundDate: now, courseRevisionId: id.courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(rounds).values({ id: id.roundId, eventId: id.eventId, eventRoundId: id.eventRoundId, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(pairings).values({ id: id.pairingId, eventRoundId: id.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT, contextId: ctx });
  for (let i = 0; i < 4; i++) await db.insert(pairingMembers).values({ pairingId: id.pairingId, playerId: ps[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx });
  if (opts.withEventConfig !== false) {
    const cfg = { game: 'guyan-2v2', pointValueSchedule: { kind: 'flat', cents: 500 }, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }], lockState: 'locked', configVersion: 1 };
    await db.insert(gameConfig).values({ id: randomUUID(), level: 'event', refId: id.eventId, configJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, lockState: 'locked', configVersion: 1, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
  }
  if (opts.lockHandicaps) {
    for (const [pid, h] of Object.entries(opts.lockHandicaps)) {
      await db.insert(eventHandicaps).values({ eventId: id.eventId, playerId: pid, handicapIndex: h, source: 'ghin', asOfDate: now, ghinValueDate: null, capturedAt: now, tenantId: TENANT, contextId: ctx });
    }
  }
  return { id, ps, hi, now };
}

beforeAll(async () => { await migrate(db, { migrationsFolder }); await client.execute('PRAGMA foreign_keys = OFF'); });
beforeEach(async () => {
  for (const t of [auditLog, roundPins, eventHandicaps, pairingMembers, pairings, gameConfig, rounds, eventRounds, events, courseHoles, courseTees, courseRevisions, courses, players]) {
    await db.delete(t);
  }
});

describe('pinRoundAtStart (AC5)', () => {
  test('pins resolved config + per-player CH from manual HI; CH differs per player', async () => {
    const { id, ps, now } = await seed();
    const res = await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: now, actorPlayerId: ps[0]! });
    expect(res.ok).toBe(true);

    const pin = (await db.select().from(roundPins).where(eq(roundPins.roundId, id.roundId)).limit(1))[0]!;
    const hcp = JSON.parse(pin.perPlayerHandicapsJson) as Record<string, { hi: number; ch: number }>;
    // CH = round(HI × slope/113 + (rating − par)) = round(HI × 1 + (72 − 72)) = round(HI).
    expect(hcp[ps[0]!]!.ch).toBe(10);
    expect(hcp[ps[1]!]!.ch).toBe(5);
    expect(hcp[ps[2]!]!.ch).toBe(20);
    expect(hcp[ps[3]!]!.ch).toBe(0);
    // The resolved config is frozen.
    const cfg = JSON.parse(pin.resolvedConfigJson) as { game: string };
    expect(cfg.game).toBe('guyan-2v2');
  });

  test('Epic 6: a foursome-level override is resolved + frozen into foursome_configs_json (even when locked)', async () => {
    const { id, ps, now } = await seed(); // event: locked, net-skins on, $5
    const ctx = `event:${id.eventId}`;
    // A foursome-level row for this round's foursome 1: SANDIE on + $10 stake.
    const foursomeCfg = {
      game: 'guyan-2v2',
      pointValueSchedule: { kind: 'flat', cents: 1000 },
      modifiers: [
        { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
        { type: 'sandie', enabled: true },
      ],
      lockState: 'locked',
      configVersion: 1,
    };
    await db.insert(gameConfig).values({
      id: randomUUID(), level: 'foursome', refId: id.pairingId, configJson: JSON.stringify(foursomeCfg),
      seedRuleSetRevisionId: null, lockState: 'locked', configVersion: 1, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
    });

    const res = await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: now, actorPlayerId: ps[0]! });
    expect(res.ok).toBe(true);

    const pin = (await db.select().from(roundPins).where(eq(roundPins.roundId, id.roundId)).limit(1))[0]!;
    // The round default stays the EVENT config ($5); the foursome map carries the override ($10 + sandie).
    expect((JSON.parse(pin.resolvedConfigJson) as { pointValueSchedule: { cents: number } }).pointValueSchedule.cents).toBe(500);
    expect(pin.foursomeConfigsJson).not.toBeNull();
    const map = JSON.parse(pin.foursomeConfigsJson!) as Record<string, { pointValueSchedule: { cents: number }; modifiers: Array<{ type: string; enabled: boolean }> }>;
    expect(map['1']).toBeDefined();
    expect(map['1']!.pointValueSchedule.cents).toBe(1000);
    expect(map['1']!.modifiers.find((m) => m.type === 'sandie')!.enabled).toBe(true);
  });

  test('Epic 6: no foursome overrides → foursome_configs_json is NULL (backward compatible)', async () => {
    const { id, ps, now } = await seed();
    const res = await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: now, actorPlayerId: ps[0]! });
    expect(res.ok).toBe(true);
    const pin = (await db.select().from(roundPins).where(eq(roundPins.roundId, id.roundId)).limit(1))[0]!;
    expect(pin.foursomeConfigsJson).toBeNull();
  });

  test('uses the H1 LOCKED snapshot HI (not the live manual) when locked', async () => {
    const { id, ps } = await seed({ lockHandicaps: { } });
    // Lock p1 to a different HI than its manual (10 → 25).
    await db.insert(eventHandicaps).values({ eventId: id.eventId, playerId: ps[0]!, handicapIndex: 25, source: 'ghin', asOfDate: Date.now(), ghinValueDate: null, capturedAt: Date.now(), tenantId: TENANT, contextId: `event:${id.eventId}` });
    const res = await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: Date.now(), actorPlayerId: ps[0]! });
    expect(res.ok).toBe(true);
    const pin = (await db.select().from(roundPins).where(eq(roundPins.roundId, id.roundId)).limit(1))[0]!;
    const hcp = JSON.parse(pin.perPlayerHandicapsJson) as Record<string, { hi: number; ch: number }>;
    expect(hcp[ps[0]!]!.hi).toBe(25); // locked snapshot, not the manual 10
    expect(hcp[ps[0]!]!.ch).toBe(25);
  });

  test('freezes events.handicapAllowancePct into the pinned resolved config', async () => {
    const { id, ps } = await seed();
    // Organizer set an 80% allowance on the event (the handicaps-lock screen).
    await db.update(events).set({ handicapAllowancePct: 80 })
      .where(eq(events.id, id.eventId));
    const res = await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: Date.now(), actorPlayerId: ps[0]! });
    expect(res.ok).toBe(true);
    const pin = (await db.select().from(roundPins).where(eq(roundPins.roundId, id.roundId)).limit(1))[0]!;
    const cfg = JSON.parse(pin.resolvedConfigJson) as { handicapAllowancePct?: number };
    expect(cfg.handicapAllowancePct).toBe(80);
  });

  test('a null allowance column leaves the pinned config without a pct (engine → 100)', async () => {
    const { id, ps } = await seed(); // handicap_allowance_pct stays NULL
    await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: Date.now(), actorPlayerId: ps[0]! });
    const pin = (await db.select().from(roundPins).where(eq(roundPins.roundId, id.roundId)).limit(1))[0]!;
    const cfg = JSON.parse(pin.resolvedConfigJson) as { handicapAllowancePct?: number };
    expect(cfg.handicapAllowancePct).toBeUndefined();
  });

  test('writes a round.pinned audit row (AC14)', async () => {
    const { id, ps } = await seed();
    await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: Date.now(), actorPlayerId: ps[0]! });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityType, 'round_pin'), eq(auditLog.entityId, id.roundId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.eventType).toBe('round.pinned');
    expect(audits[0]!.actorPlayerId).toBe(ps[0]!);
  });

  test('idempotent: a second pin is a no-op (no second audit)', async () => {
    const { id, ps } = await seed();
    await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: Date.now(), actorPlayerId: ps[0]! });
    const second = await pinRoundAtStart(db, { roundId: id.roundId, eventRoundId: id.eventRoundId, eventId: id.eventId, tenantId: TENANT, createdAt: Date.now(), actorPlayerId: ps[0]! });
    expect(second).toEqual({ ok: true, pinned: false });
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityType, 'round_pin'));
    expect(audits).toHaveLength(1); // only the first pin audited
  });
});
