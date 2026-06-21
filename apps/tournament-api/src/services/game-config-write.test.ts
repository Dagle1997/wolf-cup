/**
 * game-config-write.test.ts (Story 1.3) — the event-level config writer.
 *
 * Asserts: a first write SEEDS the Standard Guyan preset + an event-level
 * game_config row + an audit row + a `game.config_seeded` activity, all in ONE
 * tx; a second write UPDATES (point value / lock) + emits `game.config_updated`;
 * a lock-only update PRESERVES the existing point-value schedule; the preset
 * seed is idempotent (re-run is a no-op, one rule_set per tenant); fail-closed
 * on an odd-cents (invalid) point value.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rmSync } = await import('node:fs');
  const dbPath = join(tmpdir(), `gcwrite-${process.pid}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${dbPath}${suffix}`); } catch { /* fresh file */ }
  }
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const { gameConfig, ruleSets, ruleSetRevisions, auditLog, activity, players, events } = await import(
  '../db/schema/index.js'
);
const { seedOrUpdateEventGameConfig } = await import('./game-config-write.js');

const TENANT = 'guyan';
const CTX = (eventId: string) => `event:${eventId}`;

let actorId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // eslint-disable-next-line no-restricted-syntax -- test-cleanup truncate only; the T8-1 rule targets production emit paths, not beforeEach teardown
  await db.delete(activity);
  await db.delete(auditLog);
  await db.delete(gameConfig);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(events);
  await db.delete(players);
  actorId = randomUUID();
  await db.insert(players).values({
    id: actorId,
    isOrganizer: true,
    createdAt: 1,
    name: 'Organizer',
    tenantId: TENANT,
    contextId: 'league:guyan',
  });
});

/** Seed an event row so the activity FK (activity.event_id → events.id) holds. */
async function seedEvent(): Promise<string> {
  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId, name: 'E', startDate: 1, endDate: 2, timezone: 'America/New_York',
    organizerPlayerId: actorId, createdAt: 1, tenantId: TENANT, contextId: CTX(eventId),
  });
  return eventId;
}

async function run(eventId: string, args: Partial<Parameters<typeof seedOrUpdateEventGameConfig>[1]> = {}) {
  return db.transaction((tx) =>
    seedOrUpdateEventGameConfig(tx, {
      eventId,
      tenantId: TENANT,
      contextId: CTX(eventId),
      actorPlayerId: actorId,
      now: 1000,
      ...args,
    }),
  );
}

describe('seedOrUpdateEventGameConfig — first write (seed)', () => {
  test('seeds preset + event row + audit + activity in one tx', async () => {
    const eventId = await seedEvent();
    const res = await run(eventId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.seeded).toBe(true);

    // Preset seeded (one rule_set + baseline revision).
    expect(await db.select().from(ruleSets).where(eq(ruleSets.tenantId, TENANT))).toHaveLength(1);
    expect(await db.select().from(ruleSetRevisions)).toHaveLength(1);

    // Event-level game_config row.
    const rows = await db
      .select()
      .from(gameConfig)
      .where(and(eq(gameConfig.level, 'event'), eq(gameConfig.refId, eventId)));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.lockState).toBe('locked');
    expect(row.configVersion).toBe(1);
    expect(row.seedRuleSetRevisionId).not.toBeNull();
    const cfg = JSON.parse(row.configJson) as { game: string; pointValueSchedule: { cents: number } };
    expect(cfg.game).toBe('guyan-2v2');
    expect(cfg.pointValueSchedule.cents).toBe(500);

    // Audit + activity.
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.eventType).toBe('game.config_seeded');
    const acts = await db.select().from(activity).where(eq(activity.eventId, eventId));
    expect(acts).toHaveLength(1);
    expect(acts[0]!.type).toBe('game.config_seeded');
  });

  test('rejects a first seed with no point value', async () => {
    const eventId = await seedEvent();
    const res = await run(eventId);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('point_value_required_on_seed');
    // No row / activity written.
    expect(await db.select().from(gameConfig)).toHaveLength(0);
  });

  test('fails closed on an odd-cents (invalid) point value', async () => {
    const eventId = await seedEvent();
    const res = await run(eventId, { pointValueSchedule: { kind: 'flat', cents: 501 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('point_value_not_even');
    expect(await db.select().from(gameConfig)).toHaveLength(0);
  });

  test('an invalid config write produces ZERO side effects (preset/row/audit/activity)', async () => {
    const eventId = await seedEvent();
    // A doomed write (odd cents fails parseGameConfig). Validation happens
    // BEFORE the preset seed / row / audit / activity writes, and the whole op
    // rides the caller's tx → on failure NOTHING is committed.
    const res = await run(eventId, { pointValueSchedule: { kind: 'flat', cents: 501 } });
    expect(res.ok).toBe(false);

    // No preset rule_set / revision seeded as a side effect of the failed write.
    expect(await db.select().from(ruleSets)).toHaveLength(0);
    expect(await db.select().from(ruleSetRevisions)).toHaveLength(0);
    // No event-level game_config row.
    expect(await db.select().from(gameConfig)).toHaveLength(0);
    // No audit, no activity.
    expect(await db.select().from(auditLog)).toHaveLength(0);
    expect(await db.select().from(activity)).toHaveLength(0);
  });
});

describe('seedOrUpdateEventGameConfig — second write (update)', () => {
  test('updates point value + emits game.config_updated; reuses the preset', async () => {
    const eventId = await seedEvent();
    await run(eventId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    const res = await run(eventId, { pointValueSchedule: { kind: 'flat', cents: 1000 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.seeded).toBe(false);

    // Still ONE event row + ONE rule_set (idempotent preset).
    const rows = await db.select().from(gameConfig).where(eq(gameConfig.refId, eventId));
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.configJson).pointValueSchedule.cents).toBe(1000);
    expect(await db.select().from(ruleSets).where(eq(ruleSets.tenantId, TENANT))).toHaveLength(1);

    // Second activity is the UPDATE type.
    const acts = await db.select().from(activity).where(eq(activity.eventId, eventId));
    expect(acts).toHaveLength(2);
    expect(acts.some((a) => a.type === 'game.config_seeded')).toBe(true);
    expect(acts.some((a) => a.type === 'game.config_updated')).toBe(true);
  });

  test('a lock-only update preserves the existing point-value schedule', async () => {
    const eventId = await seedEvent();
    await run(eventId, { pointValueSchedule: { kind: 'front-back', frontCents: 500, backCents: 1000 } });
    const res = await run(eventId, { lockState: 'unlocked' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = (await db.select().from(gameConfig).where(eq(gameConfig.refId, eventId)))[0]!;
    expect(row.lockState).toBe('unlocked');
    const cfg = JSON.parse(row.configJson) as {
      lockState: string;
      pointValueSchedule: { kind: string; frontCents: number; backCents: number };
    };
    // Schedule preserved (not reset to the preset default).
    expect(cfg.pointValueSchedule.kind).toBe('front-back');
    expect(cfg.pointValueSchedule.frontCents).toBe(500);
    expect(cfg.pointValueSchedule.backCents).toBe(1000);
  });
});
