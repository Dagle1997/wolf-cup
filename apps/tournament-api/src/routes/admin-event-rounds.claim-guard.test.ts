/**
 * Claim-modifier start-round pre-flight guard (post-trip 2026-06-28).
 *
 * `noClaimModifiersForAnyFoursome` predicts whether a round, if started, would
 * show NO greenie/polie/sandie bonus buttons on score entry for EVERY foursome —
 * resolving each foursome the same way the pin + score-entry do (event base
 * merged with the per-foursome Epic-6 override). The start route refuses with
 * 422 `no_claim_modifiers` (overridable) when this is true.
 *
 * Root cause it guards: per-foursome games were enabled live but their claim
 * rules were never entered, so no bonuses appeared and nobody was prompted.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db };
});

const { db } = await import('../db/index.js');
const { gameConfig } = await import('../db/schema/index.js');
const { noClaimModifiersForAnyFoursome } = await import('./admin-event-rounds.js');

const TENANT = 'guyan';

// Valid Guyan configs. cents are whole-dollar (×100) so validateResolvedConfig
// passes. net-skins carries its only-supported net/single variant.
const NET_SKINS_ON = { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } };
function cfg(modifiers: unknown[]): string {
  return JSON.stringify({
    game: 'guyan-2v2',
    pointValueSchedule: { kind: 'flat', cents: 500 },
    modifiers,
    lockState: 'locked',
    configVersion: 1,
  });
}
const CLAIMS_ON = cfg([NET_SKINS_ON, { type: 'greenie', enabled: true }, { type: 'polie', enabled: true }, { type: 'sandie', enabled: true }]);
const CLAIMS_OFF = cfg([NET_SKINS_ON, { type: 'greenie', enabled: false }, { type: 'polie', enabled: false }, { type: 'sandie', enabled: false }]);
const NO_CLAIM_MODIFIERS = cfg([NET_SKINS_ON]); // only net-skins; no claim modifiers at all
const POLIE_ONLY_ON = cfg([NET_SKINS_ON, { type: 'polie', enabled: true }]);

async function insertConfig(level: 'event' | 'foursome', refId: string, configJson: string): Promise<void> {
  const now = Date.now();
  await db.insert(gameConfig).values({
    id: randomUUID(),
    level,
    refId,
    configJson,
    lockState: 'locked',
    configVersion: 1,
    createdAt: now,
    updatedAt: now,
    tenantId: TENANT,
    contextId: 'event:test',
  });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(gameConfig);
});

describe('noClaimModifiersForAnyFoursome', () => {
  test('event config with claims ON, no overrides → false (buttons will show)', async () => {
    const eventId = randomUUID();
    await insertConfig('event', eventId, CLAIMS_ON);
    expect(await noClaimModifiersForAnyFoursome(eventId, [randomUUID(), randomUUID()])).toBe(false);
  });

  test('event config with all claims OFF, no overrides → true (no buttons anywhere)', async () => {
    const eventId = randomUUID();
    await insertConfig('event', eventId, CLAIMS_OFF);
    expect(await noClaimModifiersForAnyFoursome(eventId, [randomUUID()])).toBe(true);
  });

  test('event config with NO claim modifiers at all, no overrides → true', async () => {
    const eventId = randomUUID();
    await insertConfig('event', eventId, NO_CLAIM_MODIFIERS);
    expect(await noClaimModifiersForAnyFoursome(eventId, [randomUUID()])).toBe(true);
  });

  test("Josh's live case: claims ON at event, but EVERY foursome override disables them → true", async () => {
    const eventId = randomUUID();
    const p1 = randomUUID();
    const p2 = randomUUID();
    await insertConfig('event', eventId, CLAIMS_ON);
    await insertConfig('foursome', p1, CLAIMS_OFF);
    await insertConfig('foursome', p2, CLAIMS_OFF);
    expect(await noClaimModifiersForAnyFoursome(eventId, [p1, p2])).toBe(true);
  });

  test('claims OFF at event, but ONE foursome override enables polie → false', async () => {
    const eventId = randomUUID();
    const p1 = randomUUID();
    const p2 = randomUUID();
    await insertConfig('event', eventId, CLAIMS_OFF);
    await insertConfig('foursome', p2, POLIE_ONLY_ON);
    // p1 inherits the all-off event base; p2 enables polie → at least one shows a button.
    expect(await noClaimModifiersForAnyFoursome(eventId, [p1, p2])).toBe(false);
  });

  test('fail-open: no event-level config → false (other guards own this)', async () => {
    expect(await noClaimModifiersForAnyFoursome(randomUUID(), [randomUUID()])).toBe(false);
  });

  test('fail-open: corrupt foursome config_json → false (never blocks start here)', async () => {
    const eventId = randomUUID();
    const p1 = randomUUID();
    await insertConfig('event', eventId, CLAIMS_OFF);
    await insertConfig('foursome', p1, '{not valid json');
    expect(await noClaimModifiersForAnyFoursome(eventId, [p1])).toBe(false);
  });
});
